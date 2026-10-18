"use strict";
const fs=require("node:fs/promises");
const path=require("node:path");
const {EmbedBuilder}=require("discord.js");
const DEFAULT_METRICS="/home/ray/raycraft-migration/plugins/RayCraftMetrics/status.json";
const FOOTER="RayCraft · managed status panel";
const delay=120000;
function metricPath(){return process.env.RAYCRAFT_METRICS_FILE||DEFAULT_METRICS}
async function metrics(){try{const stat=await fs.stat(metricPath());if(Date.now()-stat.mtimeMs>120000)return null;const m=JSON.parse(await fs.readFile(metricPath(),"utf8"));const ts=Date.parse(m.timestamp);if(!Number.isFinite(ts)||Math.abs(Date.now()-ts)>120000)return null;return m}catch{return null}}
async function publicStatus(){try{const a=AbortSignal.timeout(9000);const r=await fetch("https://raycraftmc.com/api/status",{signal:a});if(!r.ok)throw Error("HTTP");const j=await r.json();return j}catch{return null}}
const label=(s)=>s==="online"?"🟢 Online":s==="offline"?"🔴 Offline":"⚪ Unavailable";
function embed(p,m){const players=Number.isInteger(m?.players)?m.players:(Number.isInteger(p?.java?.players)?p.java.players:null);const f=(n,digits=1)=>typeof n==="number"&&Number.isFinite(n)?n.toFixed(digits):"N/A";const tps=typeof m?.tps==="number"?m.tps:null;const color=tps===null?0x5c7591:tps<16?0xda6d61:tps<19?0xd8af69:0x498e6a;
return new EmbedBuilder().setColor(color).setTitle("RayCraft · Server Status").setDescription("**Java:** "+label(p?.java?.state)+" · `play.raycraftmc.com`\n**Bedrock:** "+label(p?.bedrock?.state)+" · `bedrock.raycraftmc.com:19132`").addFields(
{name:"Players online",value:players===null?"N/A":String(players),inline:true},
{name:"TPS · 1 min",value:f(tps,2),inline:true},
{name:"MSPT",value:f(m?.mspt,1)+" ms",inline:true},
{name:"Average player ping",value:f(m?.avgPingMs,0)+(m?.avgPingMs==null?"":" ms"),inline:true}
).setFooter({text:FOOTER+" · updates every 2 min"}).setTimestamp(new Date());}
async function tick(client,config){const channelId=config.serverStatusChannelId;if(!/^\d{15,22}$/.test(channelId||""))return;
const channel=await client.channels.fetch(channelId);if(!channel?.isTextBased()||typeof channel.send!=="function")return;
const statePath=path.resolve(process.cwd(),"data/server-status-message.json");let saved={};try{saved=JSON.parse(await fs.readFile(statePath,"utf8"))}catch{}
let msg=null;if(saved.channelId===channelId && /^\d{15,22}$/.test(saved.messageId||"")){try{msg=await channel.messages.fetch(saved.messageId)}catch{}}
if(!msg){const messages=await channel.messages.fetch({limit:100});msg=messages.find(x=>x.author.id===client.user.id && x.embeds.some(e=>e.footer?.text?.startsWith(FOOTER)))||null;}
const payload={embeds:[embed(await publicStatus(),await metrics())],allowedMentions:{parse:[]}};
if(msg){await msg.edit(payload);return;}
msg=await channel.send(payload);await fs.mkdir(path.dirname(statePath),{recursive:true});await fs.writeFile(statePath,JSON.stringify({channelId,messageId:msg.id})+"\n",{mode:0o600});
}
function start(client,config){if(!config.serverStatusChannelId){console.log("RayCraft status panel disabled (set SERVER_STATUS_CHANNEL_ID)");return;}let busy=false;const run=async()=>{if(busy)return;busy=true;try{await tick(client,config)}catch(err){console.warn("Status panel update failed:",err.message)}finally{busy=false}};run();const timer=setInterval(run,delay);timer.unref();}
module.exports={start,metrics};