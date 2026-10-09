// ==================== KYBERSWAP AGGREGATOR (Avalanche final leg) ====================
// This app's own convention for "native asset" is ethers.ZeroAddress
// (matches AVAX_TOKENS.AVAX.address and AVAX_BRIDGE_ASSET.HERESY above) —
// KyberSwap uses a DIFFERENT sentinel (0xEeee...EEeE, their documented
// convention, same one 1inch/0x use). Every address handed to Kyber's API
// must go through this mapping first, or a native-asset quote will 400.
function toKyberAddr(addr){
  return (addr === ethers.ZeroAddress) ? KYBER_NATIVE_SENTINEL : addr;
}
// Two-step flow per KyberSwap's own documented API: GET /routes for a
// quote, then POST /route/build to turn that exact route into real,
// executable calldata + which contract to send it to. routerAddress is
// NOT constant across chains/versions — always use whatever the build
// response returns, never a hardcoded address, or execution will fail
// even though the quote looked fine.
//
// Returns null (never throws) on any failure — every caller MUST treat
// null as "no route available right now", matching how the rest of this
// app already treats a failed on-chain quote. Never let a Kyber failure
// bubble up as an uncaught exception, since that would break the whole
// Swap & Bridge estimate/submit flow rather than just disabling the
// auto-swap leg.
async function getKyberSwapQuote(tokenInAddr, tokenOutAddr, amountInWei, recipient, slippageBps){
  try{
    if(tokenInAddr.toLowerCase() === tokenOutAddr.toLowerCase()) return null; // nothing to swap
    const routeUrl = `${KYBER_API_BASE}/routes?tokenIn=${tokenInAddr}&tokenOut=${tokenOutAddr}&amountIn=${amountInWei.toString()}`;
    const routeRes = await fetch(routeUrl, { headers: { 'x-client-id': 'heresydex' } });
    if(!routeRes.ok) return null;
    const routeJson = await routeRes.json();
    const routeSummary = routeJson?.data?.routeSummary;
    if(!routeSummary) return null;

    const buildRes = await fetch(`${KYBER_API_BASE}/route/build`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-client-id': 'heresydex' },
      body: JSON.stringify({
        routeSummary,
        sender: AVALANCHE_RECEIVER,   // the contract that will actually hold + spend the bridged tokens
        recipient,                    // where the swap OUTPUT should land — the end user's own address
        slippageTolerance: Math.round(slippageBps), // basis points, e.g. 100 = 1%
        deadline: Math.floor(Date.now()/1000) + 3600
      })
    });
    if(!buildRes.ok) return null;
    const buildJson = await buildRes.json();
    const built = buildJson?.data;
    if(!built || !built.data || !built.routerAddress) return null;

    return {
      routerAddress: built.routerAddress,
      calldata: built.data,
      amountOut: routeSummary.amountOut,           // string, in tokenOut's smallest unit
      tokenOutDecimalsHint: routeSummary.tokenOut   // address, for cross-checking against what we asked for
    };
  }catch(e){
    console.warn('KyberSwap quote/build failed', e);
    return null;
  }
}

