from pathlib import Path
import shutil,subprocess,json,zipfile,sys,re,hashlib,os
source=Path(__file__).resolve().parent
root=Path(os.environ.get('GUEST_ROOT',str(Path.home()/'Desktop/exit-matrix'))).resolve();root.mkdir(parents=True,exist_ok=True)
my=Path(os.environ.get('MY98_SOURCE',str(source.parents[4]/'my98'))).resolve()
for name in ['index.html','fat.js']:shutil.copy2(source/name,root/name)
x=Path(os.environ.get('XOS_SOURCE',str(my.parent/'xos-jlxip98-small')));site=Path(os.environ.get('JLXIP_SITE',str(my.parent/'jlxip.net')));base=Path(os.environ.get('DEV_BASE',str(Path.home()/'Desktop/jlxip98-small')))
for name,target in [('app',base/'app'),('direct-pointer.js',my/'src/browser/direct-pointer.js'),('bridge.js',site/'_my98/scripts/exit-matrix/bridge.js')]:
 if not (root/name).exists():(root/name).symlink_to(target,target_is_directory=target.is_dir())
for name in ['jlxip98-small.my98','jlxip98-small.my98state']:
 if not (root/name).exists():subprocess.run(['cp','-c',str(base/name),str(root/name)],check=True)
shutil.copy2(base/'credentials.json',root/'credentials.json')
payload=root/'payload';payload.mkdir(exist_ok=True)
baseline=json.loads((base/'source-manifest.json').read_text())['sha256']
changed=[name for name in (x/'tests/windows98/sources.txt').read_text().splitlines() if hashlib.sha256((x/name).read_bytes()).hexdigest()!=baseline.get(name)]
if (payload/'update').exists():shutil.rmtree(payload/'update')
for name in changed:
 p=payload/'update'/name;p.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(x/name,p)
shutil.copy2(site/'_my98/tests/exit-matrix/index.html',payload/'MATRIX.HTM')
archive=Path(os.environ.get('VBADOS_ZIP',str(my/'build/direct-pointer/vbados.zip')))
assert hashlib.sha256(archive.read_bytes()).hexdigest()=='824d74731d719ff4c8ca7914f6f93e554812fca3a9ef8c44317c1da728184d27'
with zipfile.ZipFile(archive) as z:
 for name in ['VBMOUSE.EXE','VBMOUSE.DRV']:(payload/name).write_bytes(z.read(name))
auto=(source/'baseline/AUTOEXEC.BAT').read_bytes();ini=(source/'baseline/SYSTEM.INI').read_bytes()
assert b'vbmouse' not in ini.lower()
(payload/'AUTOEXEC.BAT').write_bytes(auto.rstrip(b'\r\n')+b'\r\nC:\\VBADOS\\VBMOUSE.EXE\r\n')
(payload/'SYSTEM.INI').write_bytes(ini.replace(b'mouse.drv=mouse.drv',b'mouse.drv=vbmouse.drv'))
def bat(n,s):(payload/n).write_bytes(s.replace('\n','\r\n').encode('ascii'))
bat('SETUP.BAT',r'''@echo off
c:
cd \ans078
xcopy d:\update\*.* c:\ans078\ /e /i /y
copy /y d:\MATRIX.HTM c:\www\matrix.htm
copy /y d:\BUILD85.BAT c:\ans078\BUILD85.BAT
call BUILD85.BAT
''')
# Native build commands are generated from the real leaf manifest. The native
# XRust helper launches retained tools; FULLRUN captures real exit codes/logs.
manifest=(x/'src/os/leaves/jlxip98.inc').read_text()
crates=re.findall(r'JLXIP98_CRATE\(\d, "([^"]+)", "([^"]+)", "([^"]+)"\)',manifest)
exports=re.findall(r'JLXIP98_EXPORT\((\d), "([^"]+)", "([^"]+)"\)',manifest)
native=re.findall(r'JLXIP98_NATIVE\("([^"]+)"\)',manifest)
commands=[]
for i,(name,source,obj) in enumerate(crates):
 args=['build\\xrc.exe','--module','--typed-abi','--crate-name',name]
 for n,entry,symbol in exports:
  if int(n)==i:args+=['--export',entry,symbol]
 if i==0:
  for path in native:args+=['--native-module',path]
 else:args+=['--extern-crate','compat',crates[0][1]]
 if i==2:args+=['--extern-crate','os',crates[1][1]]
 args+=[source,'-o','build/obj/jlxip98/'+obj]
 commands.append(' '.join(args))
commands.append(r'build\xcc.exe --link-windows-x86 @build/jlxip98.exe.objects.rsp -o build/jlxip98.exe')
runner=r'''#![allow(unsafe_code)]
#[repr(C)]
struct Startup { size: u32, reserved: u32, desktop: u32, title: u32, x:u32, y:u32, width:u32, height:u32, chars_x:u32, chars_y:u32, fill:u32, flags:u32, show:u16, reserved2:u16, data:u32, input:u32, output:u32, error:u32 }
#[repr(C)]
struct Process { process:u32, thread:u32, id:u32, thread_id:u32 }
#[link(name="kernel32",kind="raw-dylib",import_name_type="undecorated")]
unsafe extern "system" {
 fn CreateProcessA(app:u32,command:*mut u8,pa:u32,ta:u32,inherit:i32,flags:u32,env:u32,dir:u32,start:*mut Startup,process:*mut Process)->i32;
 fn WaitForSingleObject(handle:u32,time:u32)->u32;
 fn GetExitCodeProcess(handle:u32,code:*mut u32)->i32;
 fn CloseHandle(handle:u32)->i32;
}
fn launch(command:&[u8])->bool {
 let mut text=[0u8;8192];text[..command.len()].copy_from_slice(command);
 let mut start=Startup {size:68u32,reserved:0u32,desktop:0u32,title:0u32,x:0u32,y:0u32,width:0u32,height:0u32,chars_x:0u32,chars_y:0u32,fill:0u32,flags:0u32,show:0u16,reserved2:0u16,data:0u32,input:0u32,output:0u32,error:0u32};
 let mut p=Process {process:0u32,thread:0u32,id:0u32,thread_id:0u32};
 if unsafe {CreateProcessA(0u32,text.as_mut_ptr(),0u32,0u32,0i32,0u32,0u32,0u32,&mut start as *mut Startup,&mut p as *mut Process)}==0i32 {return false;}
 let wait=unsafe {WaitForSingleObject(p.process,300000u32)};
 let mut code=1u32;let ok=unsafe {GetExitCodeProcess(p.process,&mut code as *mut u32)};
 unsafe {CloseHandle(p.thread);CloseHandle(p.process);}
 wait==0u32 && ok!=0i32 && code==0u32
}
pub fn run()->i32 {
'''
for i,command in enumerate(commands):
 full=rf'C:\XOSFULL\BUILD\FULLRUN.EXE bridge{i}.log bridge{i}.status '+command
 runner+=' if !launch(b"'+full.replace('\\','\\\\').replace('"','\\"')+'") { return 1i32; }\n'
runner+=' 0i32\n}\n'
(payload/'b85native.rs').write_text(runner)
(payload/'BUILD85.RS').write_text('#![no_std]\n#![deny(unsafe_code)]\nmod b85native;\npub fn main()->i32 { b85native::run() }\n')
# Retained ABI objects from the prepared native toolchain.
(payload/'RUN85.RSP').write_text('\n'.join('\"'+p+'\"' for p in ['build/run85.o', *['build/obj/xrcb/native-abi/'+p+'.o' for p in ['src/x/c/xrcb/native_abi/compiler','src/x/c/xrcb/native_abi/concurrency','src/x/c/xrcb/host/executable','src/x/c/xrcb/host/executable-windows','src/x/c/core/error/error_message','src/x/c/core/safe_c/checking/arithmetic','src/x/c/core/safe_c/unsafe/memory']]])+'\n')

bat('BUILD85.BAT',r'''@echo off
c:
cd \ans078
if exist build85.status del build85.status
copy /y d:\BUILD85.RS c:\ans078\BUILD85.RS
copy /y d:\b85native.rs c:\ans078\b85native.rs
copy /y d:\RUN85.RSP c:\ans078\RUN85.RSP
C:\XOSFULL\BUILD\FULLRUN.EXE runner-c.log runner-c.status build\xrc.exe --module --typed-abi --native-module b85native.rs --export main main BUILD85.RS -o build\run85.o
if errorlevel 1 goto fail
C:\XOSFULL\BUILD\FULLRUN.EXE runner-l.log runner-l.status build\xcc.exe --link-windows-x86 @RUN85.RSP -o build\run85.exe
if errorlevel 1 goto fail
C:\XOSFULL\BUILD\FULLRUN.EXE runner.log runner.status build\run85.exe
if errorlevel 1 goto fail
echo PASS>build85.status
goto end
:fail
echo FAIL>build85.status
:end
''')
bat('DRIVER.BAT',r'''@echo off
if not exist c:\vbados mkdir c:\vbados
copy /y d:\VBMOUSE.EXE c:\vbados\VBMOUSE.EXE
copy /y d:\VBMOUSE.DRV c:\windows\system\VBMOUSE.DRV
copy /y d:\AUTOEXEC.BAT c:\AUTOEXEC.BAT
copy /y d:\SYSTEM.INI c:\windows\SYSTEM.INI
echo PASS>c:\ans078\driver85.status
''')
bat('HTTP85.BAT',r'''@echo off
c:
cd \ans078
C:\XOSFULL\BUILD\FULLRUN.EXE http85.log http85.status build\http-client.exe
''')
iso=root/'input.iso'
if iso.exists():iso.unlink()
subprocess.run(['hdiutil','makehybrid','-iso','-joliet','-default-volume-name','ANS085','-o',str(iso),str(payload)],check=True,stdout=subprocess.DEVNULL)
print(json.dumps({'sourceChanges':changed,'iso':str(iso)}))
