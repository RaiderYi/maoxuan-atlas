# dl_tiles.py: prefetch NatGeo terrain tiles for China region z4-z6 (ASCII-safe)
import math, os, urllib.request, ssl, time
from concurrent.futures import ThreadPoolExecutor

OUT = r"D:\工作\maoxuan_viz\site\assets\tiles"
ctx = ssl.create_default_context(); ctx.check_hostname=False; ctx.verify_mode=ssl.CERT_NONE
op = urllib.request.build_opener(urllib.request.ProxyHandler({}), urllib.request.HTTPSHandler(context=ctx))
op.addheaders=[('User-Agent','Mozilla/5.0')]

def t2xy(lon, lat, z):
    n = 2**z
    x = (lon+180)/360*n
    lat_r = math.radians(lat)
    y = (1-math.log(math.tan(lat_r)+1/math.cos(lat_r))/math.pi)/2*n
    return int(x), int(y)

LON0, LON1, LAT0, LAT1 = 70, 140, 15, 56
jobs = []
for z in (4,5,6):
    x0, y1 = t2xy(LON0, LAT0, z)  # top-left x, bottom y
    x1, y0 = t2xy(LON1, LAT1, z)
    for x in range(min(x0,x1), max(x0,x1)+1):
        for y in range(min(y0,y1), max(y0,y1)+1):
            jobs.append((z,x,y))
print("tiles to fetch:", len(jobs))

def fetch(job):
    z,x,y = job
    p = os.path.join(OUT, str(z), str(x))
    os.makedirs(p, exist_ok=True)
    f = os.path.join(p, f"{y}.jpg")
    if os.path.exists(f) and os.path.getsize(f) > 2000:
        return True
    url = f"https://server.arcgisonline.com/ArcGIS/rest/services/NatGeo_World_Map/MapServer/tile/{z}/{y}/{x}"
    for attempt in range(4):
        try:
            d = op.open(url, timeout=30).read()
            if len(d) > 2000:
                open(f,"wb").write(d)
                return True
        except Exception:
            time.sleep(1.5*(attempt+1))
    print("FAIL", job)
    return False

ok = 0
with ThreadPoolExecutor(max_workers=8) as ex:
    for r in ex.map(fetch, jobs):
        ok += 1 if r else 0
print("done:", ok, "/", len(jobs))
total = sum(os.path.getsize(os.path.join(dp,f)) for dp,_,fs in os.walk(OUT) for f in fs)
print("total size MB:", round(total/1048576,1))
