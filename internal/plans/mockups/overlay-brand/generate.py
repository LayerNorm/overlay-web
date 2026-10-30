from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.transformPen import TransformPen
from pathlib import Path
ASSET_DIR = Path(__file__).resolve().parent
REPO_ROOT = ASSET_DIR.parents[3]
F = REPO_ROOT / 'public/assets/fonts/Libre_Baskerville/static/LibreBaskerville-Regular.ttf'
t=TTFont(F); gs=t.getGlyphSet(); cmap=t.getBestCmap()
# kerning from GPOS pair adjustments (format 1 and 2)
def kern(l,r):
    try: gpos=t['GPOS'].table
    except KeyError: return 0
    for li in gpos.LookupList.Lookup:
        if li.LookupType not in (2,9): continue
        for st in li.SubTable:
            if li.LookupType==9: st=st.ExtSubTable
            if st.LookupType!=2 if hasattr(st,'LookupType') else False: continue
            cov=st.Coverage.glyphs
            if l not in cov: continue
            if st.Format==1:
                ps=st.PairSet[cov.index(l)]
                for pv in ps.PairValueRecord:
                    if pv.SecondGlyph==r: return getattr(pv.Value1,'XAdvance',0) or 0
            else:
                c1=st.ClassDef1.classDefs.get(l,0); c2=st.ClassDef2.classDefs.get(r,0)
                v=st.Class1Record[c1].Class2Record[c2].Value1
                return getattr(v,'XAdvance',0) or 0
    return 0
def glyph_path(ch,dx):
    g=gs[cmap[ord(ch)]]; p=SVGPathPen(gs)
    g.draw(TransformPen(p,(1,0,0,-1,dx,0))); return p.getCommands(),g.width
# eyes in font units (y-up) for uppercase O Regular
E=dict(cx=473,cy=415,w=66,h=138,gap=60)
def eyes_path(dx=0):
    out=[]
    for x in (E['cx']-E['gap']/2-E['w'], E['cx']+E['gap']/2):
        x+=dx; r=E['w']/2; top=-(E['cy']+E['h']/2); bot=-(E['cy']-E['h']/2)
        out.append(f"M{x} {top+r}A{r} {r} 0 0 1 {x+2*r} {top+r}L{x+2*r} {bot-r}A{r} {r} 0 0 1 {x} {bot-r}Z")
    return ''.join(out)
O,Ow=glyph_path('O',0)
MARK_BOX="43 -815 860 860"
def mark_svg(fill,bg=None,box=MARK_BOX,pad=0,rx=0):
    x,y,w,h=map(float,box.split())
    bgel=f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}" fill="{bg}"/>' if bg else ''
    if bg:  # app icon: mark scaled to ~62% inside a rounded square
        s=0.62; cx=x+w/2; cy=y+h/2
        inner=f'<g transform="translate({cx} {cy}) scale({s}) translate({-473} {385})"><path fill="{fill}" fill-rule="nonzero" d="{O}"/><path fill="{fill}" d="{eyes_path()}"/></g>'
    else:
        inner=f'<path fill="{fill}" d="{O}"/><path fill="{fill}" d="{eyes_path()}"/>'
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{box}">{bgel}{inner}</svg>\n'
# wordmark: O with eyes + "verlay"
paths=[O]; x=Ow; prev=cmap[ord('O')]
for ch in 'verlay':
    gn=cmap[ord(ch)]; x+=kern(prev,gn); d,w=glyph_path(ch,x); paths.append(d); x+=w; prev=gn
minx,maxx=40,x+20
def word_svg(fill):
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{minx} -820 {maxx-minx} 1120"><path fill="{fill}" d="{"".join(paths)}"/><path fill="{fill}" d="{eyes_path()}"/></svg>\n'
files={
 'overlay-mark-black.svg':mark_svg('#0a0a0a'),
 'overlay-mark-white.svg':mark_svg('#fafafa'),
 'overlay-wordmark-black.svg':word_svg('#0a0a0a'),
 'overlay-wordmark-white.svg':word_svg('#fafafa'),
 'overlay-app-icon-dark.svg':mark_svg('#fafafa',bg='#0a0a0a',rx=190),
 'overlay-app-icon-light.svg':mark_svg('#0a0a0a',bg='#fafafa',rx=190),
}
for n, s in files.items():
    (ASSET_DIR / n).write_text(s)
json.dump({'O':O,'eyes':eyes_path(),'E':E,'word':''.join(paths),'wordBox':[minx,maxx]},open('brand-geometry.json','w'))
print('kern O-v',kern(cmap[ord('O')],cmap[ord('v')]),'width',x)
