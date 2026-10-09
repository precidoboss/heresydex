// ==================== CONFIG ====================
const GROTTO_CHAIN_ID = 36463;
const GROTTO_CHAIN_ID_HEX = '0x' + GROTTO_CHAIN_ID.toString(16);
const GROTTO_RPC = 'https://subnets.avax.network/thegrotto/mainnet/rpc';
const GROTTO_EXPLORER = 'https://subnets.avax.network/thegrotto';
const AVAX_CHAIN_ID_HEX = '0xA86A'; // 43114
const AVAX_C_RPC = 'https://api.avax.network/ext/bc/C/rpc';

const BOB_GROTTO = '0x06057d79dBC506f7c0803F052E6c823AA4A25dEA';
const WHERESY_ADDR = '0xfA99B368B5fc1f5a061bc393dFf73BE8a097667D';
const BOB_HOME_GROTTO = '0x362c34d5df39458be2fe3a2f132dd45f0f4189a3';
const BOB_REMOTE_AVAX = '0x2F524f453430520ca26E5485017aBAA80231C53D';
const WARP_PRECOMPILE = '0x0200000000000000000000000000000000000005';
const WARP_ABI = ["function getBlockchainID() view returns (bytes32)"];
const DEXSCREENER_BOB_AVAX = 'https://api.dexscreener.com/latest/dex/pairs/avalanche/0x200ce172bf316d302d8e38e712fe0d093162b84b';

// ---- Swap & Bridge (GrottoBridgeHub / AvalancheBridgeReceiver) ----
// Deployed contracts from GrottoBridgeHub.sol / AvalancheBridgeReceiver.sol.
const GROTTO_BRIDGE_HUB = '0xA817452EF0E2F086bAe8feF9D2Ba924CB4a3Df59';   // Grotto
const AVALANCHE_RECEIVER = '0x6916c4d860869025Cc3fA8DEea686E0Eab05cfE0'; // Avalanche
// NOTE: there is no "Avalanche HeresyRouter" anymore — that was the whole
// bug. The final leg on Avalanche is quoted and executed via KyberSwap's
// public aggregator API instead (real liquidity, no pools to bootstrap).
// See getKyberSwapQuote() below. Kyber's own docs are the source for this
// endpoint shape and the native-token sentinel address — not guessed.
const KYBER_CHAIN_SLUG = 'avalanche';
const KYBER_API_BASE = 'https://aggregator-api.kyberswap.com/' + KYBER_CHAIN_SLUG + '/api/v1';
const KYBER_NATIVE_SENTINEL = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE'; // Kyber's convention for native AVAX

// Only BOB, CAVE, USDC and native HERESY are hardcoded bridge routes inside
// GrottoBridgeHub — matches _homeAndRemote() / the HERESY_HOME branch in
// GrottoBridgeHub.sol exactly. Anything else has to be swapped into one of
// these on Grotto first (the hub does that swap for you if you pass a
// different tokenIn).
const BRIDGEABLE_KEYS = ['BOB', 'CAVE', 'USDC', 'HERESY'];
// What the bridged asset is represented as once it lands on Avalanche —
// taken directly from the *_REMOTE / *_HOME constants in
// AvalancheBridgeReceiver.sol. HERESY arrives as native AVAX-denominated
// value (the receiver's native path is `payable`), so it uses Kyber's own
// native-token sentinel when quoting/building the final swap, and the
// app's usual ZeroAddress convention everywhere else in the UI.
const AVAX_BRIDGE_ASSET = {
  BOB: '0x2F524f453430520ca26E5485017aBAA80231C53D',   // BOB_REMOTE
  CAVE: '0xf294Fec63CC1aEE691943f7F17fB5187289bc522',   // CAVE_REMOTE
  USDC: '0xc2Dc59BdB6C85f80Bf604c7C47598BE1E6c5b3F7',   // USDC_HOME_AVAX
  HERESY: ethers.ZeroAddress                             // native on arrival (app convention)
};
// Real, known tokens on Avalanche C-Chain that the "final token" picker in
// Swap & Bridge offers directly (decimals + icons so the estimate shown
// before signing is accurate, not just an assumption).
const AVAX_TOKENS = {
  AVAX:   { symbol:'AVAX',   type:'native', address: ethers.ZeroAddress, decimals:18, icon:'https://cave.money/_next/image?url=%2Ftoken_images%2Favax.png&w=48&q=75&dpl=dpl_DgKkYSpURTtXetkvnwKQQ2sG8UMn' },
  HERESY: { symbol:'HERESY', type:'erc20',  address:'0x432d38F83a50EC77C409D086e97448794cf76dCF', decimals:18, icon:'https://cave.money/_next/image?url=%2Ftoken_images%2FGHERESY.png&w=96&q=75&dpl=dpl_DgKkYSpURTtXetkvnwKQQ2sG8UMn' },
  CAVE:   { symbol:'CAVE',   type:'erc20',  address:'0xf294Fec63CC1aEE691943f7F17fB5187289bc522', decimals:18, icon:'https://cave.money/caveLogo.png' },
  USDC:   { symbol:'USDC',   type:'erc20',  address:'0xc2Dc59BdB6C85f80Bf604c7C47598BE1E6c5b3F7', decimals:6,  icon:'https://cave.money/token_images/USDC.svg?dpl=dpl_DgKkYSpURTtXetkvnwKQQ2sG8U' },
  BOB:    { symbol:'BOB',    type:'erc20',  address:'0x2F524f453430520ca26E5485017aBAA80231C53D', decimals:18, icon:'https://bp.enterthegrotto.xyz/_next/image?url=%2Fimages%2Fbp-coin.png&w=96&q=75&dpl=dpl_GcjBAnqUhkqnWvG35bbXPrmWxs3t' },
};
// Which AVAX_TOKENS entry a given "bridge via" token defaults to (i.e. no
// auto-swap on arrival — just receive the bridged asset). Native HERESY
// arrives as native AVAX per AvalancheBridgeReceiver's payable path, so it
// maps to AVAX, not the wrapped "HERESY (ERC20)" token.
const SB_DEFAULT_FINAL_KEY = { BOB:'BOB', CAVE:'CAVE', USDC:'USDC', HERESY:'AVAX' };
const HUB_ABI = [
  "function swapAndBridge(address tokenIn, address bridgeToken, uint256 amountIn, uint256 minBridgeAmount, bytes destinationPayload) external",
  "function bridgeNativeAndCall(bytes destinationPayload) external payable"
];

// Deployed HeresyRouter — see conversation history for the audited source.
const ROUTER_ADDRESS = '0x84Ba409F78777DA67Efc0795Ad52FE13089DBca5';

// Every token here is paired directly against WHERESY on-chain. Addresses
// and pool addresses match exactly what was registered via seedInitialPools()
// on the router — do NOT add tokens here without also calling setPool() on
// the router first (and vice versa), or the frontend and contract will
// disagree about what's swappable.
const TOKENS = {
  HERESY:  { symbol:'HERESY',  type:'native', address: ethers.ZeroAddress, decimals:18, icon:'https://grottoexplorer.xyz/assets/configs/network_icon.png' },
  WHERESY: { symbol:'WHERESY', type:'erc20',  address: WHERESY_ADDR,       decimals:18, icon:'https://grottoexplorer.xyz/assets/configs/network_icon.png' },
  BOB:     { symbol:'BOB',     type:'erc20',  address:'0x06057d79dBC506f7c0803F052E6c823AA4A25dEA', decimals:18, pool:'0xF8602d664840DD329BaEfA8692801D21167D6E69', icon:'https://bp.enterthegrotto.xyz/_next/image?url=%2Fimages%2Fbp-coin.png&w=96&q=75&dpl=dpl_GcjBAnqUhkqnWvG35bbXPrmWxs3t' },
  CAVE:    { symbol:'CAVE',    type:'erc20',  address:'0x246002aecBcd1B125e87301814Dd259Cb5fa6ED6', decimals:18, pool:'0xE9437aBA09b2a3Ad288C7296B3cF197eE96de045', icon:'https://cave.money/caveLogo.png' },
  EARLY:   { symbol:'EARLY',   type:'erc20',  address:'0x06E5A4c7068993Dc73DbA2C87D92bEEb06B895e3', decimals:18, pool:'0x3Fa08d722D552B7D62f6ef4A6bF5d3C4e8a1D8a9', icon:'https://cave.money/_next/image?url=%2Ftoken_images%2FEARLY.png&w=64&q=75&dpl=dpl_DgKkYSpURTtXetkvnwKQQ2sG8UMn' },
  USDC:    { symbol:'USDC',    type:'erc20',  address:'0x9B0e6F566a531b8dD500DD51B0250034Ddd58366', decimals:6,  pool:'0xD61246153091D323CDF92650287B91765ea8d910', icon:'https://cave.money/token_images/USDC.svg?dpl=dpl_DgKkYSpURTtXetkvnwKQQ2sG8U' },
  ANAL:    { symbol:'ANAL',    type:'erc20',  address:'0x44a5163e580CcCe3A1dBe19C13770Bb554d113c4', decimals:18, pool:'0x79cA749Ea2503Fe03A3383fA8229a9be2e84A655', lowLiq:true, icon:'https://cave.money/_next/image?url=https%3A%2F%2Fapi.enterthegrotto.xyz%2Fimages%2Fuploads%2Ftoken-ADLogoNew-1769975640567-7204.png&w=64&q=75' },
  ERNIE:   { symbol:'ERNIE',   type:'erc20',  address:'0x055fA249CFB586fF595FdCAE54E4e454Da346DF0', decimals:18, pool:'0x212218d7d519a556bbd16e3012AC6C9A3DEb8710', lowLiq:true, icon:'https://cave.money/_next/image?url=https%3A%2F%2Fapi.enterthegrotto.xyz%2Fimages%2Fuploads%2Ftoken-logo1-1768333994638-5194.png&w=64&q=75' },
  GREG:    { symbol:'GREG',    type:'erc20',  address:'0x4CEE1f4b3808db3c6f47d521E2AB73c0A2126301', decimals:18, pool:'0xf6414180817a3fba575AfDeD570653Ca814BB191', lowLiq:true, icon:'https://cave.money/_next/image?url=https%3A%2F%2Fapi.enterthegrotto.xyz%2Fimages%2Fuploads%2Ftoken-2A15A7DE-4875-4576-99EE-527D20830940-1768673742988-5869.png&w=64&q=75' },
  SNS:     { symbol:'SNS',     type:'erc20',  address:'0x8f65793a8dB5C31f2Feb5804Ccc65f90Ff52391c', decimals:18, pool:'0x8826325D8Dcb2ebe980D2b7d8F0034b777841825', lowLiq:true, icon:'https://cave.money/_next/image?url=https%3A%2F%2Fapi.enterthegrotto.xyz%2Fimages%2Fuploads%2Ftoken-315f1120-8611-4517-9956-daf74e608c60-1779646031273-4970.jpg&w=64&q=75' },
  UNKOWN:  { symbol:'UNKOWN',  type:'erc20',  address:'0x219F9287ABa63bB0e966e12b7305539CcaDAF218', decimals:18, pool:'0x470E37FC4B15058e96A079B224BebF6Fa960e9e7', lowLiq:true, icon:'https://cave.money/_next/image?url=https%3A%2F%2Fapi.enterthegrotto.xyz%2Fimages%2Fuploads%2Ftoken-IMG_6144-1780319275259-2737.jpeg&w=64&q=75' },
  NPL:     { symbol:'NPL',     type:'erc20',  address:'0x1FB721Afd78175B94a5E66AA8a46Fb024bDFBE39', decimals:18, pool:'0x25968f5055e9220Dd7F6C91f25A9E77A0222b572', lowLiq:true, icon:'https://cave.money/_next/image?url=https%3A%2F%2Fapi.enterthegrotto.xyz%2Fimages%2Fuploads%2Ftoken-565F85E0-8EB3-400C-826C-210946BB1502-1768683610308-5531.png&w=64&q=75' },
};

const ROUTER_ABI = [
  "function quote(address tokenIn, address tokenOut, uint256 amountIn) view returns (uint256 amountOut, uint256 fee, bool routeExists)",
  "function swapExactTokensForTokens(address tokenIn, address tokenOut, uint256 amountIn, uint256 amountOutMin, address to, uint256 deadline) returns (uint256 amountOut)",
  "function swapExactNativeForTokens(address tokenOut, uint256 amountOutMin, address to, uint256 deadline) payable returns (uint256 amountOut)",
  "function swapExactTokensForNative(address tokenIn, uint256 amountIn, uint256 amountOutMin, address to, uint256 deadline) returns (uint256 amountOut)"
];

const ERC20_ABI = [
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function balanceOf(address) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)"
];

const PAIR_ABI = [
  "function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)",
  "function token0() view returns (address)",
  "function token1() view returns (address)"
];

const TOKEN_HOME_ABI = [
  "function send((bytes32 destinationBlockchainID, address destinationTokenTransferrerAddress, address recipient, address primaryFeeTokenAddress, uint256 primaryFee, uint256 secondaryFee, uint256 requiredGasLimit, address multiHopFallback) input, uint256 amount)"
];


// ---- Single source of truth for the contract tables (bridge page + docs) ----
const GROTTO_ADDR_URL = 'https://grottoexplorer.xyz/address/';
const AVAX_ADDR_URL = 'https://snowtrace.io/address/';
const CONTRACT_LIST = [
  { name:'HeresyRouter',             chain:'Grotto',    addr:ROUTER_ADDRESS,      url:GROTTO_ADDR_URL, note:'Swap router — quotes, wraps/unwraps native HERESY, hops through WHERESY, takes the 1% fee' },
  { name:'WHERESY',                  chain:'Grotto',    addr:WHERESY_ADDR,        url:GROTTO_ADDR_URL, note:'Wrapped HERESY — the hub asset every pool is paired against' },
  { name:'GrottoBridgeHub',          chain:'Grotto',    addr:GROTTO_BRIDGE_HUB,   url:GROTTO_ADDR_URL, note:'Swap & Bridge entrypoint — optional Grotto swap, then bridges to Avalanche' },
  { name:'AvalancheBridgeReceiver',  chain:'Avalanche', addr:AVALANCHE_RECEIVER,  url:AVAX_ADDR_URL,   note:'Receives bridged funds and runs the optional final swap for the recipient' },
  { name:'$BOB (underlying)',        chain:'Grotto',    addr:BOB_GROTTO,          url:GROTTO_ADDR_URL, note:'BOB token on The Grotto (700M fixed supply)' },
  { name:'ERC20TokenHome',           chain:'Grotto',    addr:BOB_HOME_GROTTO,     url:GROTTO_ADDR_URL, note:'ICTT custody contract for BOB' },
  { name:'ERC20TokenRemote',         chain:'Avalanche', addr:BOB_REMOTE_AVAX,     url:AVAX_ADDR_URL,   note:'Wrapped BOB on Avalanche C-Chain' },
];
function renderContractList(el, withNotes){
  if(!el) return;
  el.innerHTML = CONTRACT_LIST.map(c=>{
    const short = c.addr.slice(0,6)+'…'+c.addr.slice(-4);
    return `<div class="bridge-row"><div class="l">${c.name} <span class="chain-tag ${c.chain.toLowerCase()}">${c.chain}</span>${withNotes?`<div class="c-note">${c.note}</div>`:''}</div><div class="r"><a class="addr-link" href="${c.url}${c.addr}" target="_blank" rel="noopener">${short} ↗</a></div></div>`;
  }).join('');
}
