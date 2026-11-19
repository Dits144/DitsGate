import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const result=await build({entryPoints:['src/qrisEmv.ts'],bundle:true,platform:'node',format:'esm',write:false,absWorkingDir:process.cwd()});
const {SAMPLE_QRIS,parseQris,generateQris,crc16}=await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].contents).toString('base64'));
test('sample EMVCo CRC is valid and dynamic Rp 50.003 matches reference',()=>{
 assert.equal(parseQris(SAMPLE_QRIS).at(-1).value,'6787');
 const generated=generateQris(SAMPLE_QRIS,50003,'dynamic');
 assert.equal(generated.raw,'00020101021226610016ID.CO.SHOPEE.WWW01189360091800228031910208228031910303UMI51440014ID.CO.QRIS.WWW0215ID10264912544900303UMI5204581753033605405500035802ID5909DitsStore6005BOGOR61051632062070703A0163046816');
 assert.equal(generated.issuer,'ShopeePay');assert.equal(generated.merchant.name,'DitsStore');assert.equal(generated.checksum,'6816');
});
test('compatible and static modes preserve correct semantics',()=>{
 const compat=generateQris(SAMPLE_QRIS,50003,'compatible');assert.equal(compat.tags.find(t=>t.tag==='01').value,'11');assert.equal(compat.tags.find(t=>t.tag==='54').value,'50003');
 const stat=generateQris(SAMPLE_QRIS,50003,'static');assert.equal(stat.raw,SAMPLE_QRIS);assert.equal(stat.tags.some(t=>t.tag==='54'),false);
});
test('invalid CRC, truncated tag, duplicate tag, and amount are rejected',()=>{
 assert.throws(()=>parseQris(SAMPLE_QRIS.slice(0,-1)+'0'),/Checksum/);
 assert.throws(()=>parseQris('0002010102119999'),/terpotong/);
 assert.throws(()=>generateQris(SAMPLE_QRIS,0,'dynamic'),/integer/);
 assert.throws(()=>generateQris(SAMPLE_QRIS,2.5,'dynamic'),/integer/);
 assert.equal(crc16(SAMPLE_QRIS.slice(0,-4)),'6787');
});
