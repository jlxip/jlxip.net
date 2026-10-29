export function errorContext(error,phase,resource) {
    const wrapped=new Error(typeof error?.message==='string'?error.message:String(error));
    wrapped.name=typeof error?.name==='string'?error.name:'Error';
    if(error?.code!==undefined)wrapped.code=error.code;
    wrapped.phase=error?.phase||phase;
    wrapped.resource=error?.resource||resource;
    if(error?.cause!==undefined)wrapped.cause=error.cause;
    if(error?.stack)wrapped.stack=error.stack;
    if(error?.errors)wrapped.errors=error.errors;
    return wrapped;
}

export async function during(phase,work,resource) {
    try{return await work();}catch(error){throw errorContext(error,phase,resource);}
}

export function errorMessage(error,phase='Loading page') {
    const lines=[`${error?.phase||phase} failed.`],seen=new Set();
    function describe(value,prefix='',depth=0) {
        if(depth>4 || seen.has(value))return;
        seen.add(value);
        const message=typeof value?.message==='string'?value.message:typeof value==='string'?value:String(value);
        const code=typeof value?.code==='string'?value.code:typeof value?.name==='string'?value.name:'';
        lines.push(prefix+(code?code+': ':'')+(message||'No error message was provided.'));
        if(value?.resource)lines.push('Resource: '+value.resource);
        if(value?.cause!==undefined)describe(value.cause,'Caused by: ',depth+1);
        if(Array.isArray(value?.errors))for(const cause of value.errors)describe(cause,'Source: ',depth+1);
    }
    describe(error);
    return lines.join('\n');
}
