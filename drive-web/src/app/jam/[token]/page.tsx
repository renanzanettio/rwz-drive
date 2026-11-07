import type { Metadata } from "next";
import { JamRoom } from "@/components/JamRoom";
export const metadata:Metadata={title:"Jam · RWZ Drive",robots:{index:false,follow:false},referrer:"no-referrer"};
export default function JamPage({params}:{params:{token:string}}){return <JamRoom token={params.token}/>;}
