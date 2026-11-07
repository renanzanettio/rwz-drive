// Execute na pasta drive-api: npm run build && node tests/jam.integration.cjs
const assert=require('node:assert/strict');
const {mkdtempSync,mkdirSync,writeFileSync,rmSync,readFileSync}=require('node:fs');
const {join,resolve}=require('node:path');
const {tmpdir}=require('node:os');
const {randomUUID}=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
async function main(){
  const temporary=mkdtempSync(join(tmpdir(),'rwz-jam-test-'));
  process.env.DATABASE_PATH=join(temporary,'test.db');process.env.STORAGE_PATH=join(temporary,'storage');process.env.TRUST_PROXY='false';
  const owner=randomUUID(),other=randomUUID(),series=randomUUID(),show=randomUUID(),ep1=randomUUID(),ep2=randomUUID(),foreign=randomUUID(),subtitle=randomUUID();
  const stamp=new Date().toISOString();
  const old=new DatabaseSync(process.env.DATABASE_PATH);
  old.exec('PRAGMA foreign_keys=ON; CREATE TABLE _migrations(name TEXT PRIMARY KEY,applied_at TEXT NOT NULL)');
  for(const migration of ['001_init.sql','002_watch_progress.sql','003_public_shares.sql','004_users_roles_invites.sql','005_watch_completion.sql','006_media_library_tv.sql']){
    old.exec(readFileSync(resolve('src/db/migrations',migration),'utf8'));old.prepare('INSERT INTO _migrations VALUES(?,?)').run(migration,stamp);
  }
  for(const id of [owner,other])old.prepare('INSERT INTO users(id,username,password_hash,created_at,updated_at,role) VALUES(?,?,?,?,?,?)').run(id,id,'fixture',stamp,stamp,'user');
  old.prepare('INSERT INTO folders(id,owner_id,parent_id,name,created_at,updated_at) VALUES(?,?,NULL,?,?,?)').run(series,owner,'Séries',stamp,stamp);
  old.prepare('INSERT INTO folders(id,owner_id,parent_id,name,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(show,owner,series,'Série de teste',stamp,stamp);
  const store=join(process.env.STORAGE_PATH,'users',owner);mkdirSync(store,{recursive:true});
  for(const [id,who,folder,name,mime,body]of[[ep1,owner,show,'01.mp4','video/mp4','0123456789'],[ep2,owner,show,'02.mp4','video/mp4','abcdefghij'],[foreign,other,null,'Privado.mp4','video/mp4','private'],[subtitle,owner,show,'pt.srt','application/x-subrip','1\n00:00:00,000 --> 00:00:20,000\nLegenda\n']]){
    old.prepare('INSERT INTO files(id,owner_id,folder_id,original_name,storage_name,mime_type,size,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run(id,who,folder,name,id,mime,Buffer.byteLength(body),stamp,stamp);
    if(who===owner)writeFileSync(join(store,id),body);
  }
  old.prepare('INSERT INTO watch_progress(file_id,owner_id,position_seconds,duration_seconds,updated_at) VALUES(?,?,?,?,?)').run(ep1,owner,8,30,stamp);
  for(const id of [ep1,ep2])old.prepare('INSERT INTO media_file_settings(file_id,owner_id,duration_seconds) VALUES(?,?,30)').run(id,owner);
  old.prepare('INSERT INTO media_subtitles VALUES(?,?,?,?)').run(ep1,subtitle,owner,'Português');old.close();
  const {db,runMigrations}=require(resolve('dist/db'));runMigrations();runMigrations();
  assert.equal(db.prepare('SELECT position_seconds FROM watch_progress WHERE file_id=?').get(ep1).position_seconds,8);
  const {createSession}=require(resolve('dist/services/session.service'));
  const ownerCookie='rwz_session='+createSession(owner).id,otherCookie='rwz_session='+createSession(other).id;
  const {app}=require(resolve('dist/app'));
  const {closeJamConnections}=require(resolve('dist/modules/jam/jam.routes'));
  const {roomPosition,recoverJams}=require(resolve('dist/modules/jam/jam.service'));
  const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  const origin='http://127.0.0.1:'+server.address().port;
  async function raw(path,{method='GET',body,auth,cookie,headers={}}={}){
    return fetch(origin+'/api'+path,{method,headers:{...(body?{'Content-Type':'application/json'}:{}),...(auth?{Authorization:'Bearer '+auth}:{}),...(cookie?{Cookie:cookie}:{}),...headers},body:body?JSON.stringify(body):undefined});
  }
  async function api(path,options){const response=await raw(path,options);return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};}
  let sseAbort;
  try{
    assert.equal((await api('/jam/rooms',{method:'POST',body:{file_id:ep1}})).status,401);
    assert.equal((await api('/jam/rooms',{method:'POST',cookie:ownerCookie,body:{file_id:foreign}})).status,403);
    const created=await api('/jam/rooms',{method:'POST',cookie:ownerCookie,body:{file_id:ep1}});assert.equal(created.status,201);
    const token=created.data.token,base='/jam/'+token;
    assert.match(token,/^[a-f0-9]{64}$/);
    assert.equal((await api('/jam/rooms',{cookie:otherCookie})).data.rooms.length,0);
    assert.equal((await api('/jam/rooms',{cookie:ownerCookie})).data.rooms[0].token,token);
    const invitation=await api(base+'/preview');assert.equal(invitation.status,200);assert.ok(!JSON.stringify(invitation.data).includes(owner));
    assert.equal((await api(base+'/join',{method:'POST',cookie:otherCookie,body:{name:'Intruso',host:true}})).status,403);
    const host=await api(base+'/join',{method:'POST',cookie:ownerCookie,body:{name:'Renan',host:true}});
    const guest=await api(base+'/join',{method:'POST',body:{name:'Amiga',host:false}});
    assert.equal(host.status,201);assert.equal(guest.status,201);assert.ok(host.cookie&&guest.cookie);
    const h=host.data.secret,g=guest.data.secret,member=guest.data.state.member_id;
    let state=host.data.state;
    assert.equal(state.position_seconds,8);assert.equal(state.paused,true);assert.equal(state.playlist.length,2);
    assert.equal(guest.data.state.can_control,false);assert.equal(guest.data.state.is_host,false);
    assert.equal((await api(base+'/state')).status,401);
    const media=base+'/media/'+member;
    assert.equal((await raw(media+'/stream/'+ep1)).status,401);
    assert.equal((await raw(media+'/stream/'+foreign,{cookie:guest.cookie})).status,403);
    const ranged=await raw(media+'/stream/'+ep1,{cookie:guest.cookie,headers:{Range:'bytes=2-5'}});assert.equal(ranged.status,206);assert.equal(await ranged.text(),'2345');
    const suffix=await raw(media+'/stream/'+ep1,{cookie:guest.cookie,headers:{Range:'bytes=-3'}});assert.equal(await suffix.text(),'789');
    assert.equal((await raw(media+'/stream/'+ep1,{cookie:guest.cookie,headers:{Range:'bytes=200-'}})).status,416);
    assert.equal((await raw(media+'/stream/'+ep1,{cookie:guest.cookie,headers:{Range:'bytes=0-1,5-7'}})).status,416);
    const sub=await raw(media+'/subtitles/'+ep1+'/'+subtitle,{cookie:guest.cookie});assert.equal(sub.status,200);assert.match(await sub.text(),/^WEBVTT/);
    assert.equal((await api('/files/'+ep1+'/progress')).status,401);
    assert.equal((await api(base+'/progress/'+ep1,{auth:g})).status,403);
    assert.equal((await api(base+'/progress/'+foreign,{auth:h})).status,403);
    assert.equal((await api(base+'/command',{method:'POST',auth:g,body:{revision:state.revision,action:'play'}})).status,403);
    async function send(action,body={},access=h){
      const result=await api(base+'/command',{method:'POST',auth:access,body:{revision:state.revision,action,...body}});
      assert.equal(result.status,200,JSON.stringify(result.data));if(!result.data.closed)state=result.data;return result.data;
    }
    sseAbort=new AbortController();
    const events=await fetch(origin+'/api'+base+'/events',{headers:{Authorization:'Bearer '+g},signal:sseAbort.signal});assert.equal(events.status,200);assert.match(events.headers.get('content-type'),/text\/event-stream/);
    const reader=events.body.getReader();const initial=await reader.read();assert.match(Buffer.from(initial.value).toString(),/event: state/);
    await send('play',{position_seconds:8});assert.equal(state.paused,false);
    const pushed=await reader.read();assert.match(Buffer.from(pushed.value).toString(),/"paused":false/);
    const follower=(await api(base+'/state',{auth:g})).data;assert.equal(follower.paused,false);assert.ok(follower.position_seconds>=8&&follower.position_seconds<10);
    const joining=await api(base+'/join',{method:'POST',body:{name:'Cheguei depois'}});assert.equal(joining.data.state.file_id,ep1);assert.equal(joining.data.state.paused,false);assert.ok(joining.data.state.position_seconds>=8);
    assert.equal((await api(base+'/command',{method:'POST',auth:h,body:{revision:1,action:'pause'}})).status,409);
    await send('pause',{position_seconds:12.25});assert.equal(state.paused,true);assert.equal(state.position_seconds,12.25);
    await send('seek',{position_seconds:18});assert.equal(state.position_seconds,18);assert.equal(state.paused,true);
    await send('rate',{playback_rate:1.5});assert.equal(state.playback_rate,1.5);
    assert.equal((await api(base+'/command',{method:'POST',auth:h,body:{revision:state.revision,action:'seek',position_seconds:-1}})).status,400);
    assert.equal((await api(base+'/command',{method:'POST',auth:h,body:{revision:state.revision,action:'select',file_id:foreign}})).status,403);
    await send('settings',{guests_control:true,auto_next:true});
    await send('pause',{position_seconds:11},g);assert.equal(state.position_seconds,11);
    assert.equal((await api(base+'/command',{method:'POST',auth:g,body:{revision:state.revision,action:'close'}})).status,403);
    assert.equal((await api(base+'/duration',{method:'POST',auth:g,body:{file_id:ep1,seconds:30}})).status,403);
    await send('select',{file_id:ep2});assert.equal(state.file_id,ep2);assert.equal(state.position_seconds,0);
    assert.equal((await raw(media+'/stream/'+ep1,{cookie:guest.cookie})).status,403);
    assert.equal((await raw(media+'/subtitles/'+ep2+'/'+subtitle,{cookie:guest.cookie})).status,404);
    await send('select',{file_id:ep1});
    const learned=await api(base+'/duration',{method:'POST',auth:h,body:{file_id:ep1,seconds:30}});assert.equal(learned.status,200);
    const before=(await api(base+'/progress/'+ep1,{auth:h})).data;
    assert.equal(before.position_seconds,8); // Convidados nunca gravam o histórico pessoal.
    const saved=await api(base+'/progress/'+ep1,{method:'PUT',auth:h,body:{position_seconds:15,duration_seconds:30,expected_updated_at:before.updated_at}});assert.equal(saved.status,200);assert.equal(saved.data.position_seconds,15);
    assert.equal((await api(base+'/progress/'+ep1,{method:'PUT',auth:h,body:{position_seconds:16,duration_seconds:30,expected_updated_at:before.updated_at}})).status,409);
    await send('play',{position_seconds:29});
    db.prepare('UPDATE watch_jams SET anchored_at=? WHERE token=?').run(Date.now()-5000,token);
    state=(await api(base+'/state',{auth:h})).data;assert.equal(state.file_id,ep2);assert.equal(state.paused,false);
    db.prepare("UPDATE watch_jam_members SET last_seen_at=? WHERE room_id=(SELECT id FROM watch_jams WHERE token=?) AND role='host'").run(Date.now()-100000,token);
    state=(await api(base+'/state',{auth:g})).data;assert.equal(state.paused,true);
    state=(await api(base+'/state',{auth:h})).data;
    await send('kick',{member_id:member});assert.equal((await api(base+'/state',{auth:g})).status,401);assert.equal((await raw(media+'/stream/'+ep2,{cookie:guest.cookie})).status,401);
    sseAbort.abort();
    await send('play',{position_seconds:3});recoverJams();state=(await api(base+'/state',{auth:h})).data;assert.equal(state.paused,true);
    const hypothetical={...db.prepare('SELECT * FROM watch_jams WHERE token=?').get(token),paused:0,anchored_at:1000,position_seconds:2,playback_rate:1.5};assert.equal(roomPosition(hypothetical,3000),5);
    await send('close');assert.equal((await api(base+'/state',{auth:h})).status,410);assert.equal((await api(base+'/preview')).status,410);
    const another=(await api('/jam/rooms',{method:'POST',cookie:ownerCookie,body:{file_id:ep1}})).data.token;
    const fresh=await api('/jam/'+another+'/join',{method:'POST',body:{name:'Outra sala'}});
    assert.equal((await api('/jam/'+another+'/state',{auth:h})).status,401);
    db.prepare('UPDATE watch_jams SET expires_at=? WHERE token=?').run(Date.now()-1,another);
    assert.equal((await api('/jam/'+another+'/state',{auth:fresh.data.secret})).status,410);
    console.log('OK: migração preserva histórico; convite sem conta; isolamento; streaming Range e legendas; eventos em tempo real; play/pause/seek/velocidade; entrada tardia; conflitos; permissões; troca e próximo episódio; progresso do anfitrião; reconexão; ausência do anfitrião; remoção; reinício; encerramento e expiração.');
  }finally{sseAbort?.abort();closeJamConnections();await new Promise(resolve=>server.close(resolve));db.close();rmSync(temporary,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
