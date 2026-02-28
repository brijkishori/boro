import { NextResponse } from 'next/server';

export async function GET() {
  const appUrl = 'https://boro-ruddy.vercel.app'; // Your live Vercel domain

  const config = {
    "accountAssociation": {
    "header": "eyJmaWQiOjI4NDAyMTUsInR5cGUiOiJjdXN0b2R5Iiwia2V5IjoiMHhhQThDODQ5MUNmMTFhOEQwRUJkRjYxNDAwMGU0MmQ0MzRiZUQ2RmM1In0",
    "payload": "eyJkb21haW4iOiJib3JvLXJ1ZGR5LnZlcmNlbC5hcHAifQ",
    "signature": "L/+mgYlAuiiZzrHAl2kTsjO6gA1MKTFXCTDhhqk8BRxIPsnk2VqrOYyUL5NShrPlPrgN/vGbCDhgggnZy8sPPxw="
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
