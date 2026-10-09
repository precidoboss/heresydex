// ==================== BRIDGE ====================
async function refreshBridgeBalances(){
  document.getElementById('bal-bob-grotto').textContent = '–';
  document.getElementById('bal-bob-avax').textContent = '–';
  if(!userAddress) return;
  try{
    const bal = await bobRO.balanceOf(userAddress);
    document.getElementById('bal-bob-grotto').textContent = fmtAdaptive(parseFloat(ethers.formatUnits(bal,18))) + ' BOB';
  }catch(e){}
  try{
    const avaxProvider = new ethers.JsonRpcProvider(AVAX_C_RPC);
    const remote = new ethers.Contract(BOB_REMOTE_AVAX, ERC20_ABI, avaxProvider);
    const bal = await remote.balanceOf(userAddress);
    document.getElementById('bal-bob-avax').textContent = fmtAdaptive(parseFloat(ethers.formatUnits(bal,18))) + ' BOB';
  }catch(e){}
}
async function doBridge(){
  if(!userAddress){ connectWallet(); return; }
  const amtStr = document.getElementById('bridge-amount').value;
  const amt = parseFloat(amtStr || '0');
  if(!amt || amt<=0){ toast('Enter an amount to bridge','error'); return; }
  const recipientInput = document.getElementById('bridge-recipient').value.trim();
  const recipient = recipientInput || userAddress;
  if(!ethers.isAddress(recipient)){ toast('Recipient is not a valid address','error'); return; }
  const requiredGasLimit = BigInt(document.getElementById('bridge-gaslimit').value || '350000');
  const feeAmt = parseFloat(document.getElementById('bridge-fee').value || '0');

  const btn = document.getElementById('btn-bridge');
  btn.disabled = true;
  try{
    setTxStatus('tx-bridge','Reading Avalanche C-Chain blockchain ID…','pending',true);
    const avaxProvider = new ethers.JsonRpcProvider(AVAX_C_RPC);
    const warpAvax = new ethers.Contract(WARP_PRECOMPILE, WARP_ABI, avaxProvider);
    const destinationBlockchainID = await warpAvax.getBlockchainID();

    const amountWei = ethers.parseUnits(amt.toString(), 18);
    const feeWei = ethers.parseUnits(feeAmt.toString(), 18);

    const bobWrite = new ethers.Contract(BOB_GROTTO, ERC20_ABI, signer);
    const homeWrite = new ethers.Contract(BOB_HOME_GROTTO, TOKEN_HOME_ABI, signer);

    const totalNeeded = amountWei + feeWei;
    const allowance = await bobWrite.allowance(userAddress, BOB_HOME_GROTTO);
    if(allowance < totalNeeded){
      setTxStatus('tx-bridge','Step 1/2 — Approve $BOB for the bridge (sign in wallet)…','pending',true);
      const txA = await bobWrite.approve(BOB_HOME_GROTTO, totalNeeded);
      await txA.wait(1);
    }

    const input = {
      destinationBlockchainID,
      destinationTokenTransferrerAddress: BOB_REMOTE_AVAX,
      recipient,
      primaryFeeTokenAddress: BOB_GROTTO,
      primaryFee: feeWei,
      secondaryFee: 0n,
      requiredGasLimit,
      multiHopFallback: ethers.ZeroAddress
    };

    setTxStatus('tx-bridge','Step 2/2 — Sending across the bridge (sign in wallet)…','pending',true);
    const tx = await homeWrite.send(input, amountWei);
    setTxStatus('tx-bridge','Confirming on Grotto — funds arrive on Avalanche shortly after…','pending',true);
    const receipt = await tx.wait(1);
    setTxStatus('tx-bridge','✅ Bridge transaction sent! Wrapped $BOB should land on Avalanche within a couple minutes.','success');
    toast('Bridge tx sent 🎉','success');
    pushTxHistory({
      type: 'bridge',
      amountIn: amt,
      recipient,
      hash: receipt?.hash || tx.hash,
      chain: 'avax-warp',
      t: Date.now()
    });
    document.getElementById('bridge-amount').value='';
    refreshBridgeBalances();
    if(document.getElementById('page-portfolio').classList.contains('active')) refreshPortfolio();
  }catch(e){
    setTxStatus('tx-bridge','❌ '+friendlyError(e)+' — try "Open Official Bridge" instead.','error');
  }finally{
    btn.disabled = false;
  }
}

