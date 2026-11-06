import test from 'node:test';
import assert from 'node:assert/strict';
import { gweiToWeiCeiling, validateGasResponse, manualEligibility, settlementDecision, SEPOLIA_GENESIS, type AuctionSnapshot, type CostPolicy } from '../src/cre-domain.js';
const now=BigInt(Date.parse('2026-11-06T12:00:00Z')/1000);
const stats=()=>({gas_price_updated_at:'2026-11-06T11:59:50.123Z',gas_prices:{average:0.33}});
const identity={height:0,hash:SEPOLIA_GENESIS};
const policy:CostPolicy={gasBudgetWei:1000000000000000n,finalizeGasUnits:650000n,recoverGasUnits:650000n,maxDeferralSeconds:1800n,maxGasPriceWei:200000000000n};
const gas=()=>validateGasResponse(stats(),identity,now,180n,policy.maxGasPriceWei);
const lot:AuctionSnapshot={id:1n,mode:1,state:1,expiry:now-10n,committedAt:now-200n,highest:1000000n,quantity:10n**18n,asset:`0x${'12'.repeat(20)}`};
test('gas units convert with integer ceilings, including scientific notation',()=>{
 for(const [v,n] of [[0.33,330000000n],['0.000000001',1n],['1e-10',1n],['1.0000000001',1000000001n],['2',2000000000n]] as const)assert.equal(gweiToWeiCeiling(v),n);
 for(const v of [-1,NaN,Infinity,'-1','ETH 1',{},'1e99'])assert.throws(()=>gweiToWeiCeiling(v));
});
test('real-provider shape requires Sepolia genesis, fresh timestamp and bounded units',()=>{
 const good=gas();assert.equal(good.status,'VALID');if(good.status==='VALID'){assert.equal(good.gasPriceWei,330000000n);assert.equal(good.chainId,11155111);}
 const variants=[{}, {...stats(),gas_price_updated_at:undefined},{...stats(),gas_price_updated_at:'2026-01-01T00:00:00Z'},{...stats(),gas_price_updated_at:'2026-11-07T00:00:00Z'},{...stats(),gas_prices:{average:-1}},{...stats(),gas_prices:{average:1000000}}];
 for(const v of variants)assert.equal(validateGasResponse(v,identity,now,180n,policy.maxGasPriceWei).status,'DATA_UNAVAILABLE');
 assert.equal(validateGasResponse(stats(),{height:0,hash:'mainnet'},now,180n,policy.maxGasPriceWei).status,'DATA_UNAVAILABLE');
 assert.equal(validateGasResponse({...stats(),gas_prices:{average:{wei:'330000000'}}},identity,now,180n,policy.maxGasPriceWei).status,'VALID');
});
test('eligibility follows the exact auction state machine without changing beneficiary terms',()=>{
 assert.equal(manualEligibility(undefined,now).status,'NO_ACTIVE_LOT');assert.equal(manualEligibility({...lot,mode:2,state:4},now).status,'UNSUPPORTED_MODE');
 assert.equal(manualEligibility({...lot,expiry:now+1n},now).status,'WAITING_FOR_EXPIRY');
 assert.equal(manualEligibility(lot,now).manualAction,'finalizeAuction');
 for(const state of [3,4])assert.equal(manualEligibility({...lot,state},now).manualAction,'recover');
 for(const state of [2,5])assert.equal(manualEligibility({...lot,state},now).status,'COMPLETED');
});
test('high costs defer only nonurgent attempts and retain permissionless manual recovery',()=>{
 const low={...policy,gasBudgetWei:1n};const funded=settlementDecision(lot,now,17n,gas(),low);assert.equal(funded.status,'EXECUTE');assert.equal(funded.action,'FINALIZE_AUCTION');
 const recovery=settlementDecision({...lot,state:4,highest:0n},now,17n,gas(),low);assert.equal(recovery.status,'GAS_BUDGET_DEFERRAL');assert.equal(recovery.action,null);assert.equal(recovery.manualAction,'recover');assert.equal(recovery.estimatedFeeWei,214500000000000n);
 const overdue=settlementDecision({...lot,state:4,highest:0n,expiry:now-1801n},now,17n,gas(),low);assert.equal(overdue.status,'EXECUTE');
});
test('unavailable or implausible external data never produces a signed-action decision',()=>{
 const unavailable=validateGasResponse(null,identity,now,180n,policy.maxGasPriceWei);const d=settlementDecision(lot,now,17n,unavailable,policy);assert.equal(d.status,'DATA_UNAVAILABLE');assert.equal(d.action,null);assert.equal(d.estimatedFeeWei,null);assert.equal(d.manualAction,'finalizeAuction');
 const mismatch=settlementDecision(lot,now,1000000000n,gas(),policy);assert.equal(mismatch.status,'EXTERNAL_DATA_MISMATCH');assert.equal(mismatch.action,null);
});
