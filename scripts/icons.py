"""Build small code-drawn icons without image dependencies."""
from pathlib import Path
import math,struct,zlib
def distance(x,y,a,b):
    ax,ay=a;bx,by=b;t=max(0,min(1,((x-ax)*(bx-ax)+(y-ay)*(by-ay))/((bx-ax)**2+(by-ay)**2)))
    return math.hypot(x-ax-t*(bx-ax),y-ay-t*(by-ay))
def make(size):
    data=bytearray()
    for y in range(size):
        data.append(0)
        for x in range(size):
            samples=[]
            for sy in range(4):
                for sx in range(4):
                    px=(x+(sx+.5)/4)*128/size;py=(y+(sy+.5)/4)*128/size
                    rounded=math.hypot(max(0,abs(px-64)-39),max(0,abs(py-64)-39))<=23
                    ink=min(distance(px,py,(37,37),(88,88)),distance(px,py,(60,88),(88,88)),distance(px,py,(88,60),(88,88)))<=5
                    samples.append((221,238,192,255) if ink else (29,83,70,255) if rounded else (0,0,0,0))
            data.extend(round(sum(s[i] for s in samples)/16) for i in range(4))
    def chunk(kind,value):return struct.pack('>I',len(value))+kind+value+struct.pack('>I',zlib.crc32(kind+value)&0xffffffff)
    return b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',size,size,8,6,0,0,0))+chunk(b'IDAT',zlib.compress(bytes(data)))+chunk(b'IEND',b'')
root=Path(__file__).resolve().parents[1]/'extension'/'icons';root.mkdir(exist_ok=True)
for size in [16,32,48,128]:(root/f'icon{size}.png').write_bytes(make(size))
