import {NextRequest,NextResponse} from "next/server";
import {completeGooglePhotos} from "@/lib/googlePhotos";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function GET(req:NextRequest){
  let ok=false;
  try{await completeGooglePhotos(req.nextUrl.searchParams.get("state")||"",req.nextUrl.searchParams.get("code")||"",req.nextUrl.searchParams.has("error"));ok=!req.nextUrl.searchParams.has("error");}catch{}
  return new NextResponse(`<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SLR Studios · Google Photos</title><body style="background:#101020;color:white;font-family:system-ui;padding:32px"><h1>${ok?"Google Photos approved":"Google Photos was not connected"}</h1><p>${ok?"Return to SLR Studios to finish connecting. You can close this tab.":"Return to Settings in SLR Studios and try connecting again."}</p><p>Your SLR Studios account and saved media are unchanged.</p></body></html>`,{status:ok?200:400,headers:{"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store","Referrer-Policy":"no-referrer","Content-Security-Policy":"default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'"}});
}
