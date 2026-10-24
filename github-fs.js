/*
 NEST FS1 experimental asymmetric one-time-prekey envelopes for GitHub comments.
 Each message uses fresh sender ECDH + one recipient single-use ECDH key.
 Consumed private keys are removed from Android encrypted state before plaintext
 delivery. Identity keys are ECDSA, pinned on first PSK-authenticated bundle.
 No historical snapshots or shared static AES channel key are used by FS1.
 WARNING: Not audited Signal Double Ratchet or MLS, no post-compromise recovery.
*/
((root,factory)=>{
 const api=factory();
 if(root)root.NESTGitHubFS=api;
 if(typeof module==="object"&&module.exports)module.exports=api;
})(typeof window!=="undefined"?window:globalThis,()=>{
"use strict";
const MARKER="<!-- NEST-FS1 -->", MAX_KEYS=20, MIN_KEYS=6, MAX_MESSAGE=6000;
const encoder=new TextEncoder(),decoder=new TextDecoder();
const bytes=x=>typeof x==="string"?encoder.encode(x):x;
const b64=x=>{let s="";for(const b of new Uint8Array(x))s+=String.fromCharCode(b);return btoa(s);};
const un64=x=>Uint8Array.from(atob(x),c=>c.charCodeAt(0));
const hex=x=>[...new Uint8Array(x)].map(n=>n.toString(16).padStart(2,"0")).join("");
const canonical=o=>JSON.stringify(o);
const requireValue=(test,message)=>{if(!test)throw Error(message);};
const same=(a,b)=>{if(a.length!==b.length)return false;let c=0;for(let i=0;i<a.length;i++)c|=a[i]^b[i];return c===0;};
class FSChannel {
 constructor({room,load,save,cryptoProvider}){
  requireValue(typeof room==="string"&&/^[0-9a-f]{64}$/.test(room),"Invalid room");
  requireValue(typeof load==="function"&&typeof save==="function","Native encrypted state required");
  const c=cryptoProvider || globalThis.crypto;
  requireValue(c&&c.subtle&&c.getRandomValues,"WebCrypto required");
  this.room=room;this.load=load;this.save=save;this.crypto=c;this.subtle=c.subtle;
  this.state=null;this.bootstrap=null;
 }
 random(n=16){let a=new Uint8Array(n);this.crypto.getRandomValues(a);return a;}
 async sha(v){return new Uint8Array(await this.subtle.digest("SHA-256",bytes(v)));}
 async hmac(key,text){
  const imported=await this.subtle.importKey("raw",key,{name:"HMAC",hash:"SHA-256"},false,["sign"]);
  return new Uint8Array(await this.subtle.sign("HMAC",imported,bytes(text)));
 }
 async hkdf(secret,info){
  const k=await this.subtle.importKey("raw",secret,"HKDF",false,["deriveBits"]);
  const salt=await this.sha("NEST-FS1-ROOM:"+this.room);
  return new Uint8Array(await this.subtle.deriveBits({name:"HKDF",hash:"SHA-256",salt,info:bytes(info)},k,256));
 }
 async identityPrivate(key){return this.subtle.importKey("pkcs8",un64(key),{name:"ECDSA",namedCurve:"P-256"},false,["sign"]);}
 async identityPublic(key){return this.subtle.importKey("spki",un64(key),{name:"ECDSA",namedCurve:"P-256"},false,["verify"]);}
 async dhPrivate(key){return this.subtle.importKey("pkcs8",un64(key),{name:"ECDH",namedCurve:"P-256"},false,["deriveBits"]);}
 async dhPublic(key){return this.subtle.importKey("spki",un64(key),{name:"ECDH",namedCurve:"P-256"},false,[]);}
 async sign(payload){const k=await this.identityPrivate(this.state.identity.private);return b64(await this.subtle.sign({name:"ECDSA",hash:"SHA-256"},k,bytes(canonical(payload))));}
 async verify(payload,sig,pub){try{
  const k=await this.identityPublic(pub);
  return this.subtle.verify({name:"ECDSA",hash:"SHA-256"},k,un64(sig),bytes(canonical(payload)));
 }catch{return false;}}
 async mac(payload){requireValue(this.bootstrap,"Pairing secret required");return b64(await this.hmac(this.bootstrap,"NEST-FS1-PAIR:"+canonical(payload)));}
 _save(){const s=canonical(this.state);this.save(s);requireValue(this.load()===s,"SecureStore commit failed");}
 async open(secret=""){
  const data=this.load();
  if(data){
   const state=JSON.parse(data);
   requireValue(state.v===1&&state.room===this.room&&state.identity&&Array.isArray(state.prekeys),"Invalid encrypted FS state");
   this.state=state;
  }else{
   requireValue(typeof secret==="string"&&secret.length>=43,"Strong initial QR secret required");
   const identity=await this.subtle.generateKey({name:"ECDSA",namedCurve:"P-256"},true,["sign","verify"]);
   this.state={v:1,room:this.room,id:hex(this.random(16)),
    identity:{
     private:b64(await this.subtle.exportKey("pkcs8",identity.privateKey)),
     public:b64(await this.subtle.exportKey("spki",identity.publicKey))
    },peer:null,prekeys:[],issued:0,sentKeys:[]};
   await this.replenish();
  }
  if(!this.state.peer){
   requireValue(typeof secret==="string"&&secret.length>=43,"Unpaired device requires original QR secret");
   this.bootstrap=await this.hkdf(bytes(secret),"NEST-FS1-BOOTSTRAP-MAC");
  }
  return this;
 }
 async replenish(){
  requireValue(this.state,"Not initialized");
  if(this.state.prekeys.length>=MIN_KEYS)return false;
  for(let i=this.state.prekeys.length;i<MAX_KEYS;i++){
   const kp=await this.subtle.generateKey({name:"ECDH",namedCurve:"P-256"},true,["deriveBits"]);
   this.state.prekeys.push({id:hex(this.random(12)),
    public:b64(await this.subtle.exportKey("spki",kp.publicKey)),
    private:b64(await this.subtle.exportKey("pkcs8",kp.privateKey))});
  }
  this.state.issued++;
  this._save();
  return true;
 }
 async bundle(){
  requireValue(this.state,"Not initialized");
  const doc={kind:"bundle",v:1,room:this.room,from:this.state.id,
   identity:this.state.identity.public,issue:this.state.issued,
   prekeys:this.state.prekeys.map(p=>({id:p.id,public:p.public}))};
  const signed={...doc,sig:await this.sign(doc)};
  if(this.bootstrap)signed.pairMac=await this.mac(doc);
  return signed;
 }
 async acceptBundle(input){
  requireValue(input?.kind==="bundle"&&input.v===1&&input.room===this.room,"Wrong bundle");
  const {kind,v,room,from,identity,issue,prekeys,sig,pairMac}=input;
  requireValue(typeof from==="string"&&/^[0-9a-f]{32}$/.test(from)&&from!==this.state.id,"Invalid peer ID");
  requireValue(typeof identity==="string"&&identity.length<320
   &&Number.isSafeInteger(issue)&&issue>=1
   &&Array.isArray(prekeys)&&prekeys.length>0&&prekeys.length<=MAX_KEYS,"Malformed bundle");
  const seen=new Set();
  for(const p of prekeys){
   requireValue(typeof p.id==="string"&&/^[a-f0-9]{24}$/.test(p.id)
    &&typeof p.public==="string"&&p.public.length<320&&!seen.has(p.id),"Invalid prekey");
   seen.add(p.id);
  }
  const unsigned={kind,v,room,from,identity,issue,prekeys};
  requireValue(await this.verify(unsigned,sig,identity),"Invalid signed identity");
  if(this.state.peer){
   requireValue(this.state.peer.id===from&&this.state.peer.identity===identity,"Peer identity changed");
   if(issue<=this.state.peer.issue)return false;
  }else{
   requireValue(this.bootstrap&&typeof pairMac==="string","QR authentication required");
   requireValue(same(un64(pairMac),un64(await this.mac(unsigned))),"Incorrect QR key or forged identity");
   this.state.peer={id:from,identity,issue:0,prekeys:[]};
  }
  this.state.peer.issue=issue;
  this.state.peer.prekeys=prekeys.filter(p=>!(this.state.sentKeys||[]).includes(p.id));
  this._save();
  this.bootstrap=null;
  return true;
 }
 async _agreement(priv,pub){
  const k=await this.dhPrivate(priv),p=await this.dhPublic(pub);
  return new Uint8Array(await this.subtle.deriveBits({name:"ECDH",public:p},k,256));
 }
 _aad(header){return bytes("NEST-FS1-AEAD:"+canonical(header));}
 async seal(event){
  requireValue(this.state?.peer,"Verify paired identity before sending");
  const selected=this.state.peer.prekeys.find(p=>!(this.state.sentKeys||[]).includes(p.id));
  requireValue(selected,"Recipient has no unused prekeys; wait for refreshed bundle");
  const plain=bytes(canonical(event));
  requireValue(plain.length>0&&plain.length<=MAX_MESSAGE,"Message too large");
  const ephemeral=await this.subtle.generateKey({name:"ECDH",namedCurve:"P-256"},true,["deriveBits"]);
  const eph=b64(await this.subtle.exportKey("spki",ephemeral.publicKey));
  const priv=b64(await this.subtle.exportKey("pkcs8",ephemeral.privateKey));
  const header={v:1,kind:"message",room:this.room,from:this.state.id,to:this.state.peer.id,
   key:selected.id,eph,nonce:b64(this.random(12))};
  let shared;
  try{
   shared=await this._agreement(priv,selected.public);
   const secret=await this.hkdf(shared,"NEST-FS1-MESSAGE:"+canonical(header));
   const key=await this.subtle.importKey("raw",secret,{name:"AES-GCM"},false,["encrypt"]);
   const data=b64(await this.subtle.encrypt({name:"AES-GCM",iv:un64(header.nonce),
      additionalData:this._aad(header),tagLength:128},key,plain));
   const unsigned={...header,data};
   const output={...unsigned,sig:await this.sign(unsigned)};
   // Commit prekey use BEFORE making ciphertext available to network.
   this.state.sentKeys=(this.state.sentKeys||[]).concat(selected.id);
   this.state.peer.prekeys=this.state.peer.prekeys.filter(p=>p.id!==selected.id);
   this._save();
   secret.fill(0);
   return output;
  }finally{if(shared)shared.fill(0);}
 }
 async openMessage(input){
  requireValue(this.state?.peer,"Unpaired FS receiver");
  const {v,kind,room,from,to,key,eph,nonce,data,sig}=input||{};
  requireValue(v===1&&kind==="message"&&room===this.room
   &&from===this.state.peer.id&&to===this.state.id,"Wrong recipient or sender");
  requireValue(typeof key==="string"&&/^[a-f0-9]{24}$/.test(key)
   &&typeof eph==="string"&&eph.length<320
   &&typeof nonce==="string"&&un64(nonce).length===12
   &&typeof data==="string"&&data.length<12000,"Malformed encrypted packet");
  const header={v,kind,room,from,to,key,eph,nonce};
  requireValue(await this.verify({...header,data},sig,this.state.peer.identity),"Invalid sender signature");
  const selected=this.state.prekeys.find(p=>p.id===key);
  if(!selected)return null; // Duplicate, already consumed, or unknown prekey.
  let shared,plaintext;
  try {
   shared=await this._agreement(selected.private,eph);
   const secret=await this.hkdf(shared,"NEST-FS1-MESSAGE:"+canonical(header));
   const cryptoKey=await this.subtle.importKey("raw",secret,{name:"AES-GCM"},false,["decrypt"]);
   const decrypted=await this.subtle.decrypt({
     name:"AES-GCM",iv:un64(nonce),additionalData:this._aad(header),tagLength:128
   },cryptoKey,un64(data));
   secret.fill(0);
   plaintext=JSON.parse(decoder.decode(decrypted));
   requireValue(plaintext&&typeof plaintext==="object"
     &&typeof plaintext.id==="string"&&/^[0-9a-f-]{36}$/i.test(plaintext.id)
     &&["chat","task_comment"].includes(plaintext.type),"Bad event payload");
   // Persist destruction of consumed private prekey BEFORE handing plaintext to UI.
   this.state.prekeys=this.state.prekeys.filter(p=>p.id!==key);
   this._save();
   return plaintext;
  }finally{if(shared)shared.fill(0);}
 }
 fingerprint(){return this.sha(this.state.identity.public).then(v=>hex(v).slice(0,32));}
 paired(){return Boolean(this.state?.peer);}
 prekeysRemaining(){return this.state?.prekeys.length||0;}
}
return {FSChannel,MARKER};
});