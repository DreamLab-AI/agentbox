import os, pty, sys, time, select, re
envf, timeout, keys, ab = sys.argv[1:5]
env = dict(os.environ, PATH=os.environ["FAKEBIN"]+":"+os.environ["PATH"], ISAAC_SIM_ENV_FILE=envf, ISAAC_SIM_PICK_TIMEOUT=timeout)
env.pop("ISAAC_SIM_GPU_UUID", None)
code = 'eval "$(awk \'/^isaac_sim_saved_uuid\\(\\) \\{/,/^}/\' %s; awk \'/^isaac_sim_save_uuid\\(\\) \\{/,/^}/\' %s; awk \'/^isaac_sim_select_gpu\\(\\) \\{/,/^}/\' %s)"; CYAN=;GREEN=;RED=;YELLOW=;NC=; SCRIPT_DIR=/nonexistent; isaac_sim_select_gpu; echo "RC=$? UUID=$ISAAC_SIM_GPU_UUID"' % (ab,ab,ab)
pid, fd = pty.fork()
if pid == 0: os.execvpe("bash", ["bash","-c",code], env)
out=b""
def pump(t):
    global out
    end=time.time()+t
    while time.time()<end:
        r,_,_=select.select([fd],[],[],0.05)
        if r:
            try: out+=os.read(fd,4096)
            except OSError: return
pump(0.8)
if keys!="NONE":
    for k in keys.split(","):
        os.write(fd,{"DOWN":b"\x1b[B","UP":b"\x1b[A","ENTER":b"\r","2":b"2","0":b"0"}[k]); pump(0.25)
t0=time.time(); done=False
while time.time()-t0<8:
    pump(0.2)
    try:
        w,_=os.waitpid(pid,os.WNOHANG)
        if w: done=True;break
    except ChildProcessError: done=True;break
txt=re.sub(rb"\x1b\[[0-9;]*[A-Za-z]",b"",out).decode(errors="replace").replace("\r","")
print(("FINISHED" if done else "HUNG"), [l for l in txt.splitlines() if l.startswith("RC=")][-1:] )
