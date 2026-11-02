// Runs only inside a bounded CPU-only systemd unit, behind a per-host flock.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),sharp=require('sharp'),{execFileSync}=require('node:child_process');
process.umask(0o077);sharp.cache({memory:16,files:0,items:8});sharp.concurrency(1);
const [file,expected]=process.argv.slice(2),target=file+'.reference.png',manifest=file+'.reference.json',temporary=target+'.'+crypto.randomUUID()+'.tmp',metaTemp=manifest+'.'+crypto.randomUUID()+'.tmp';
async function digest(file){const hash=crypto.createHash('sha256');for await(const block of fs.createReadStream(file))hash.update(block);return hash.digest('hex');}
(async()=>{
 let code='corrupt';
 try{
  const stat=fs.lstatSync(file);if(!stat.isFile()||stat.nlink!==1||stat.size>512*1024**2||! /^[a-f0-9]{64}$/.test(expected)||await digest(file)!==expected){code='integrity';throw Error('integrity');}
  const fd=fs.openSync(file,'r'),head=Buffer.alloc(64);fs.readSync(fd,head,0,64,0);fs.closeSync(fd);
  const bmp=head.subarray(0,2).toString()==='BM',safe=bmp||head.subarray(0,3).equals(Buffer.from([255,216,255]))||head.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||/^GIF8[79]a/.test(head.toString('ascii',0,6))||head.toString('ascii',0,4)==='RIFF'&&head.toString('ascii',8,12)==='WEBP'||head.toString('ascii',0,4)==='II*\0'||head.toString('ascii',0,4)==='MM\0*'||head.toString('ascii',4,8)==='ftyp'&&/avif|avis|heic|heix|heif|mif1|msf1/.test(head.toString('ascii',8,64));
  if(!safe){code='unsupported';throw Error('unsupported');}
  let metadata,mime;
  if(bmp){
   const probe=JSON.parse(execFileSync('/usr/bin/ffprobe',['-v','error','-protocol_whitelist','file,pipe','-show_entries','stream=width,height','-of','json',file],{timeout:10000,maxBuffer:16384}));metadata=probe.streams[0];mime='image/bmp';
   execFileSync('/usr/bin/ffmpeg',['-nostdin','-v','error','-protocol_whitelist','file,pipe','-i',file,'-frames:v','1','-vf',"scale=w='min(2048,iw)':h='min(2048,ih)':force_original_aspect_ratio=decrease",'-threads','1','-f','image2','-c:v','png',temporary],{timeout:30000,maxBuffer:16384});
  }else{
   const options={limitInputPixels:false,sequentialRead:true,animated:false,pages:1,failOn:'error'};
   metadata=await sharp(file,options).metadata();mime={jpeg:'image/jpeg',png:'image/png',webp:'image/webp',tiff:'image/tiff',gif:'image/gif',heif:head.toString('ascii',8,64).includes('avif')?'image/avif':'image/heic'}[metadata.format];
   if(!mime){code='unsupported';throw Error('unsupported');}
   await sharp(file,options).rotate().resize({width:2048,height:2048,fit:'inside',withoutEnlargement:true}).png().toFile(temporary);
  }
  const output=await sharp(temporary).metadata(),size=fs.statSync(temporary).size;if(!output.width||!output.height||output.width>2048||output.height>2048||size>20*1024**2)throw Error('output');
  const result={version:1,sourceSha256:expected,sha256:await digest(temporary),bytes:size,mime,width:output.width,height:output.height,originalWidth:metadata.width,originalHeight:metadata.height};
  fs.renameSync(temporary,target);fs.writeFileSync(metaTemp,JSON.stringify(result),{flag:'wx',mode:0o600});fs.renameSync(metaTemp,manifest);console.log(JSON.stringify({ok:true,...result}));
 }catch(error){if(/Unsupported compression|unsupported codec|No decoding plugin|heif.*support/i.test(String(error)))code='unsupported';console.log(JSON.stringify({ok:false,code}));process.exitCode=1;}
 finally{for(const p of [temporary,metaTemp]){try{fs.unlinkSync(p);}catch{}}}
})();
