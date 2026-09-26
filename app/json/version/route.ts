/** Chrome and the Cursor browser probe this path. Serve it so Next.js does not 404. */
export function GET() {
  return Response.json({
    Browser: 'Simple BTC Borrow',
    'Protocol-Version': '1.3',
  });
}
