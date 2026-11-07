// Na pasta drive-api: npm run build && node tests/music.integration.cjs
const assert=require('node:assert/strict');
const {mkdtempSync,mkdirSync,writeFileSync,rmSync,readFileSync}=require('node:fs');
const {join,resolve}=require('node:path');
const {tmpdir}=require('node:os');
const {randomUUID}=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
async function main(){
  const temp=mkdtempSync(join(tmpdir(),'rwz-music-'));
  process.env.DATABASE_PATH=join(temp,'legacy.db');process.env.STORAGE_PATH=join(temp,'storage');process.env.TRUST_PROXY='false';
  const owner=randomUUID(),other=randomUUID(),folder=randomUUID(),child=randomUUID(),a=randomUUID(),b=randomUUID(),c=randomUUID(),foreign=randomUUID(),video=randomUUID(),cover=randomUUID(),foreignCover=randomUUID(),legacyToken='a'.repeat(64);
  const stamp=new Date().toISOString(),old=new DatabaseSync(process.env.DATABASE_PATH);
  old.exec('PRAGMA foreign_keys=ON; CREATE TABLE _migrations(name TEXT PRIMARY KEY,applied_at TEXT NOT NULL)');
  for(const migration of ['001_init.sql','002_watch_progress.sql','003_public_shares.sql','004_users_roles_invites.sql','005_watch_completion.sql','006_media_library_tv.sql','007_watch_jams.sql']){old.exec(readFileSync(resolve('src/db/migrations',migration),'utf8'));old.prepare('INSERT INTO _migrations VALUES(?,?)').run(migration,stamp);}
  for(const id of [owner,other])old.prepare('INSERT INTO users(id,username,password_hash,created_at,updated_at,role) VALUES(?,?,?,?,?,?)').run(id,id,'fixture',stamp,stamp,'user');
  for(const [id,parent,name]of[[folder,null,'Meu álbum'],[child,folder,'Disco 2']])old.prepare('INSERT INTO folders(id,owner_id,parent_id,name,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(id,owner,parent,name,stamp,stamp);
  const store=join(process.env.STORAGE_PATH,'users',owner);mkdirSync(store,{recursive:true});
  for(const [id,who,parent,name,mime]of[[a,owner,folder,'Aurora - 01 Caminho.mp3','audio/mpeg'],[b,owner,folder,'Aurora - 02 Brisa.mp3','audio/mpeg'],[c,owner,child,'03 Horizonte.ogg','application/ogg'],[foreign,other,null,'Secreto.mp3','audio/mpeg'],[video,owner,folder,'Filme.mp4','video/mp4'],[cover,owner,folder,'capa.png','image/png'],[foreignCover,other,null,'Privada.png','image/png']]){
    old.prepare('INSERT INTO files(id,owner_id,folder_id,original_name,storage_name,mime_type,size,created_at,updated_at) VALUES(?,?,?,?,?,?,10,?,?)').run(id,who,parent,name,id,mime,stamp,stamp);
    if(who===owner)writeFileSync(join(store,id),'0123456789');
  }
  old.prepare('INSERT INTO watch_progress(file_id,owner_id,position_seconds,duration_seconds,updated_at) VALUES(?,?,?,?,?)').run(video,owner,8,30,stamp);
  old.prepare('INSERT INTO watch_jams(id,token,owner_id,host_user_id,name,playlist_json,file_id,position_seconds,anchored_at,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
    .run(randomUUID(),legacyToken,owner,owner,'Jam antiga',JSON.stringify([{id:video,title:'Filme',show:'',duration:30}]),video,8,Date.now(),Date.now(),Date.now()+3600000);old.close();
  const {db,runMigrations}=require(resolve('dist/db'));runMigrations();runMigrations();
  assert.equal(db.prepare('SELECT media_kind FROM watch_jams WHERE token=?').get(legacyToken).media_kind,'video');assert.equal(db.prepare('SELECT position_seconds FROM watch_progress WHERE file_id=?').get(video).position_seconds,8);
  const {createSession}=require(resolve('dist/services/session.service')),cookie='rwz_session='+createSession(owner).id,otherCookie='rwz_session='+createSession(other).id;
  const {app}=require(resolve('dist/app')),{closeJamConnections}=require(resolve('dist/modules/jam/jam.routes'));
  const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));}),origin='http://127.0.0.1:'+server.address().port;
  async function api(path,{method='GET',body,auth,session=cookie,headers={},raw=false}={}){const response=await fetch(origin+'/api'+path,{method,headers:{...(session?{Cookie:session}:{}),...(auth?{Authorization:'Bearer '+auth}:{}),...(body?{'Content-Type':'application/json'}:{}),...headers},body:body?JSON.stringify(body):undefined});if(raw)return response;return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};}
  try{
    assert.equal((await api('/music/',{session:null})).status,401);
    let catalog=(await api('/music/')).data;assert.equal(catalog.tracks.length,3);assert.ok(!JSON.stringify(catalog).includes('Secreto'));
    assert.equal(catalog.tracks.find(t=>t.id===a).artist,'Aurora');assert.equal(catalog.tracks.find(t=>t.id===a).cover_file_id,cover);
    assert.equal((await api('/music/tracks/'+foreign,{method:'PATCH',body:{favorite:true}})).status,403);
    assert.equal((await api('/music/tracks/'+video,{method:'PATCH',body:{favorite:true}})).status,400);
    assert.equal((await api('/music/tracks/'+a,{method:'PATCH',body:{duration_seconds:0}})).status,400);
    const edited=await api('/music/tracks/'+a,{method:'PATCH',body:{title:'Caminho',artist:'Aurora',album:'Viagem',favorite:true,duration_seconds:30}});assert.equal(edited.data.title,'Caminho');assert.equal(edited.data.favorite,true);
    let created=await api('/music/playlists',{method:'POST',body:{name:'Estrada',description:'Minha seleção',file_ids:[a,b],cover_file_id:cover}});assert.equal(created.status,201);let list=created.data;
    assert.deepEqual(list.file_ids,[a,b]);assert.equal(list.revision,1);
    assert.equal((await api('/music/playlists',{method:'POST',body:{name:'Não pode',file_ids:[a,foreign]}})).status,403);
    assert.equal((await api('/music/playlists',{method:'POST',body:{name:'Não pode',file_ids:[video]}})).status,400);
    assert.equal((await api('/music/playlists',{method:'POST',body:{name:'Não pode',file_ids:[a,a]}})).status,400);
    assert.equal((await api('/music/playlists/'+list.id,{method:'PUT',session:otherCookie,body:{revision:list.revision,name:'Intruso'}})).status,404);
    assert.equal((await api('/music/',{session:otherCookie})).data.playlists.length,0);
    assert.equal((await api('/music/playlists/'+list.id,{method:'PUT',body:{revision:list.revision,cover_file_id:foreignCover}})).status,403);
    list=(await api('/music/playlists/'+list.id,{method:'PUT',body:{revision:list.revision,name:'Estrada de noite',file_ids:[b,a]}})).data;assert.equal(list.revision,2);assert.deepEqual(list.file_ids,[b,a]);
    assert.equal((await api('/music/playlists/'+list.id,{method:'PUT',body:{revision:1,file_ids:[]}})).status,409);
    list=(await api('/music/playlists/'+list.id+'/folder',{method:'POST',body:{revision:list.revision,folder_id:folder}})).data;assert.deepEqual(list.file_ids,[b,a,c]);
    assert.equal((await api('/music/playlists/'+list.id,{method:'DELETE',body:{revision:1}})).status,409);
    const jam=(await api('/jam/rooms',{method:'POST',body:{file_id:b,playlist_id:list.id}})).data,base='/jam/'+jam.token;
    assert.equal((await api('/jam/rooms',{method:'POST',session:otherCookie,body:{file_id:foreign,playlist_id:list.id}})).status,404);
    assert.equal((await api('/jam/rooms',{method:'POST',body:{file_id:a,file_ids:[a,foreign]}})).status,403);
    assert.equal((await api('/jam/rooms',{method:'POST',body:{file_id:a,file_ids:[b]}})).status,400);
    const host=await api(base+'/join',{method:'POST',body:{name:'Renan',host:true}}),guest=await api(base+'/join',{method:'POST',session:null,body:{name:'Amigo'}});
    assert.equal(host.status,201);assert.equal(guest.data.state.media_kind,'audio');assert.deepEqual(guest.data.state.playlist.map(t=>t.id),[b,a,c]);assert.equal(guest.data.state.can_control,false);assert.equal(guest.data.state.subtitles.length,0);
    const h=host.data.secret,g=guest.data.secret,media=base+'/media/'+guest.data.state.member_id;
    const ranged=await api(media+'/stream/'+b,{session:guest.cookie,headers:{Range:'bytes=1-3'},raw:true});assert.equal(ranged.status,206);assert.match(ranged.headers.get('content-type'),/audio\/mpeg/);assert.equal(await ranged.text(),'123');
    assert.equal((await api(media+'/stream/'+a,{session:guest.cookie,raw:true})).status,403);
    assert.equal((await api(base+'/progress/'+b,{auth:h,session:null})).status,403);
    assert.equal((await api('/music/',{session:null})).status,401);
    let state=host.data.state;
    async function command(action,body={}){const result=await api(base+'/command',{method:'POST',auth:h,session:null,body:{revision:state.revision,action,...body}});assert.equal(result.status,200,JSON.stringify(result.data));if(!result.data.closed)state=result.data;return result.data;}
    await command('play',{position_seconds:0});assert.equal((await api(base+'/state',{auth:g,session:null})).data.paused,false);
    await command('pause',{position_seconds:5});assert.equal(state.position_seconds,5);
    await command('seek',{position_seconds:10});assert.equal(state.position_seconds,10);
    assert.equal((await api(base+'/command',{method:'POST',auth:g,session:null,body:{revision:state.revision,action:'select',file_id:a}})).status,403);
    await command('select',{file_id:a});assert.equal(state.title,'Caminho');assert.equal(state.artist,'Aurora');assert.equal(state.album,'Viagem');
    assert.equal((await api(base+'/duration',{method:'POST',auth:h,session:null,body:{file_id:b,seconds:40}})).status,409);
    assert.equal((await api(base+'/duration',{method:'POST',auth:h,session:null,body:{file_id:a,seconds:35}})).status,200);
    assert.equal((await api('/music/')).data.tracks.find(t=>t.id===a).duration_seconds,35);
    await command('play',{position_seconds:34});db.prepare('UPDATE watch_jams SET anchored_at=? WHERE token=?').run(Date.now()-3000,jam.token);
    state=(await api(base+'/state',{auth:h,session:null})).data;assert.equal(state.file_id,c);assert.equal(state.paused,false);
    assert.equal(db.prepare('SELECT count(*) n FROM watch_progress WHERE file_id IN (?,?,?)').get(a,b,c).n,0);
    await command('close');assert.equal((await api(media+'/stream/'+c,{session:guest.cookie,raw:true})).status,410);
    db.prepare('UPDATE files SET deleted_at=? WHERE id=?').run(stamp,b);catalog=(await api('/music/')).data;assert.ok(!catalog.tracks.some(t=>t.id===b));assert.deepEqual(catalog.playlists[0].file_ids,[a,c]);
    assert.equal((await api('/music/playlists/'+list.id,{method:'DELETE',body:{revision:list.revision}})).status,200);
    assert.equal((await api('/music/')).data.playlists.length,0);assert.equal(db.prepare('SELECT deleted_at FROM files WHERE id=?').get(a).deleted_at,null);
    console.log('OK: migração e Jams antigas preservadas; músicas e metadados; favoritos; capas; playlists privadas; ordem; pasta recursiva e deduplicação; conflitos e rollback; Jam de áudio; streaming Range; controle; próxima faixa; duração; isolamento; encerramento; histórico de vídeo intacto.');
  }finally{closeJamConnections();await new Promise(resolve=>server.close(resolve));db.close();rmSync(temp,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
