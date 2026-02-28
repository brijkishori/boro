import { NextResponse } from 'next/server';

export async function GET() {
  const appUrl = 'https://boro-ruddy.vercel.app'; // Your live Vercel domain

  const config = {
    accountAssociation: {
      header: "PASTE_YOUR_HEADER_HERE",
      payload: "PASTE_YOUR_PAYLOAD_HERE",
      signature: "PASTE_YOUR_SIGNATURE_HERE"
    },
    frame: {
      version: "1",
      name: "BORO",
      iconUrl: `${appUrl}/icon.png`,
      homeUrl: appUrl,
      imageUrl: `${appUrl}/icon.png`,
      buttonTitle: "Launch App",
      splashImageUrl: `${appUrl}/icon.png`,
      splashBackgroundColor: "#ffffff"
    }
  };

  return NextResponse.json(config);
}