import test from 'node:test';
import assert from 'node:assert/strict';
import {during,errorContext,errorMessage} from '../runtime/errors.js';

test('shows the original code, message, resource and cause',()=>{
    const failure=Object.assign(new Error('Could not read state',{cause:new TypeError('Load failed')}),
        {code:'TRANSPORT_ERROR',resource:'state.my98state'});
    assert.equal(errorMessage(failure,'Loading saved state'),
        'Loading saved state failed.\nTRANSPORT_ERROR: Could not read state\nResource: state.my98state\nCaused by: TypeError: Load failed');
});
test('parallel runtime failure retains its own phase when configuration has advanced',async()=>{
    const failure=Object.freeze(errorContext(new TypeError('Importing a module script failed.'),'Loading runtime','build/libv86.mjs'));
    await assert.rejects(during('Loading configuration',()=>Promise.reject(failure)),error=>{
        assert.equal(error.phase,'Loading runtime');assert.equal(error.name,'TypeError');
        assert.equal(error.resource,'build/libv86.mjs');assert.match(errorMessage(error),/Importing a module/);return true;
    });
});
test('retains aggregate source failures and handles circular causes',()=>{
    const failure=new AggregateError([new Error('Seed A timed out'),new TypeError('Seed B unavailable')],'No source available');
    failure.cause=failure;
    assert.equal(errorMessage(failure,'Opening publication'),
        'Opening publication failed.\nAggregateError: No source available\nSource: Error: Seed A timed out\nSource: TypeError: Seed B unavailable');
});
test('thrown strings and unnamed values remain visible',()=>{
    assert.equal(errorMessage('WebAssembly is unavailable','Loading runtime'),'Loading runtime failed.\nWebAssembly is unavailable');
    assert.equal(errorMessage({message:'No saved state',code:'NO_STATE'}),'Loading page failed.\nNO_STATE: No saved state');
});
