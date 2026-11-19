"use client";
import React from "react";
import H3CharacterVoiceCorrection from "./H3CharacterVoiceCorrection";
import ExtractCharactersAction from "./ExtractCharactersAction";
import type {FixVoicesHandoff} from "./TestingFixVoices";
import type {ExtractionPlayerSource} from "@/lib/videoCharacters/playerSource";
export default function H3CompletedMediaActions({voiceSource,extraction}:{voiceSource?:FixVoicesHandoff;extraction?:ExtractionPlayerSource}) {
 return <>{extraction&&<ExtractCharactersAction {...extraction}/>} {voiceSource&&<H3CharacterVoiceCorrection source={voiceSource}/>}</>;
}
