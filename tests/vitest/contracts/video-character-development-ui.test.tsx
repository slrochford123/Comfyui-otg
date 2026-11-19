// @vitest-environment jsdom
import React from 'react';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {cleanup,render,screen} from '@testing-library/react';
import CharacterDevelopmentPanel from '@/app/app/components/CharacterDevelopmentPanel';
import type {Candidate,Workspace} from '@/lib/videoCharacters/contract';
afterEach(cleanup);
const candidate=(id:string):Candidate=>({id,name:'Boy',description:'Child',file:id+'.png',frame:'frame',bbox:[0,0,1000,1000],selected:true,approved:false,views:[],alternateForms:[],voiceId:null,voiceReviewed:false,origin:'captured'});
function setup(n:number,change?:(c:Candidate)=>void){const candidates=Array.from({length:n},(_,i)=>candidate('source-'+i));candidates[0].referenceIds=candidates.map(c=>c.id);change?.(candidates[0]);const workspace={id:'workspace',candidates} as Workspace;render(<CharacterDevelopmentPanel workspace={workspace} character={candidates[0]} busy={false} media={file=>'/media/'+file} onAction={vi.fn()}/>);}
describe('required source-image button matrix',()=>{
 it.each([1,2,3,4])('%i sources enforce Save Character and Create Model',n=>{setup(n);expect((screen.getByRole('button',{name:'Save Character',exact:true}) as HTMLButtonElement).disabled).toBe(n!==1);expect((screen.getByRole('button',{name:'Create Model',exact:true}) as HTMLButtonElement).disabled).toBe(false);expect(screen.queryByRole('button',{name:'Create Character Card',exact:true})).toBeNull();expect(screen.queryByRole('button',{name:'Create RefMod',exact:true})).toBeNull();});
 it('does not unlock a Card for an unapproved model',()=>{setup(1,c=>{c.development={version:1,modelId:'model'};c.views=[{id:'model',angle:'Default front full body',developmentRole:'model',state:'ready',file:'model.png'}];});expect(screen.getByRole('button',{name:'Approve Model'})).toBeTruthy();expect(screen.queryByRole('button',{name:'Create Character Card',exact:true})).toBeNull();});
 it('unlocks Card after default approval without requiring a voice',()=>{setup(1,c=>{c.development={version:1,modelId:'model',approvedModelId:'model'};c.views=[{id:'model',angle:'Default front full body',developmentRole:'model',state:'ready',file:'model.png',approvedAt:'approved'}];});expect((screen.getByRole('button',{name:'Create Character Card',exact:true}) as HTMLButtonElement).disabled).toBe(false);expect(screen.queryByRole('button',{name:'Create RefMod',exact:true})).toBeNull();});
});
