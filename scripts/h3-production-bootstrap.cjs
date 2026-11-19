// Release-local, reversible enablement of the reviewed H3 tools. Never enables Testing.
if(process.env.OTG_ENV==='prod'){
 const fs=require('node:fs'),path=require('node:path');
 process.env.OTG_H3_CHARACTER_DEVELOPMENT_ENABLED='1';
 process.env.OTG_H3_CHANGE_VOICE_ENABLED='1';
 // Reuse installed executable/model artifacts. Outputs, sessions and user media stay in PROD roots.
 const shared='/home/shawn-rochford/AI/runtime/test/voice-dubbing';
 process.env.SEED_VC_ROOT??=path.join(shared,'src','seed-vc');
 process.env.SEED_VC_PYTHON??=path.join(shared,'venv','bin','python');
 process.env.SEED_VC_HF_CACHE??=path.join(shared,'hf-cache');
 process.env.OTG_SPEAKER_DIARIZATION_PYTHON??=path.join(shared,'diarization-venv','bin','python');
 process.env.OTG_SPEAKER_DIARIZATION_MODEL??=path.join(shared,'models','pyannote-community-1');
 const engines=JSON.parse(fs.readFileSync(process.env.OTG_AUDIO_ENGINE_CONFIG||'/etc/slr/production-clip-audio.json','utf8'));
 process.env.OTG_AUDIO_ANALYSIS_PYTHON??=engines.python;
 for(const key of ['SEED_VC_ROOT','SEED_VC_PYTHON','SEED_VC_HF_CACHE','OTG_SPEAKER_DIARIZATION_PYTHON','OTG_SPEAKER_DIARIZATION_MODEL','OTG_AUDIO_ANALYSIS_PYTHON']){
  if(!fs.existsSync(process.env[key]))throw Error('Missing installed H3 dependency: '+key);
 }
}
