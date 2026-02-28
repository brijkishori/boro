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
      name: "Simple BTC Borrow",
      homeUrl: appUrl,
      iconUrl: `${appUrl}/icon.png`, // Using the clean square logo as the icon
      splashImageUrl: `${appUrl}/splash.png`, // Displayed while loading
      splashBackgroundColor: "#ffffff", // Matches the background of the image
      subtitle: "Borrow USDC against cbBTC",
      description: "A secure and transparent way to unlock liquidity from your Bitcoin holdings on Base using Morpho Blue.",
      screenshotUrls: [
        `${appUrl}/screenshots/s1.png`, // Ensure you create this file in /public/screenshots/
        `${appUrl}/screenshots/s2.png`, // Ensure you create this file in /public/screenshots/
        `${appUrl}/screenshots/s3.png`  // Ensure you create this file in /public/screenshots/
      ],
      primaryCategory: "finance",
      tags: ["defi", "lending", "bitcoin", "base","morpho","usdc","borrow usdc without platform fee"], // <-- ADDED HERE
      heroImageUrl: `${appUrl}/hero.png`, // The discovery feed cover photo
      tagline: "Unlock your BTC liquidity instantly",
      ogTitle: "Simple BTC Borrow",
      ogDescription: "The easiest way to borrow USDC using cbBTC as collateral.",
      ogImageUrl: `${appUrl}/hero.png`,
      noindex: false
    }
  };

  return NextResponse.json(config);
}
