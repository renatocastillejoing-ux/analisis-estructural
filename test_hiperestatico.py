# -*- coding: utf-8 -*-
import json, sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

with open('hiperestatico_test.json', 'r', encoding='utf-8') as f:
    data = json.load(f)

modelo = data
print('=== MODELO ===')
print('Unidades:', modelo.get('unidad', 'N/A'))
print('Material E:', modelo['material']['E'])
print('Nudos:', len(modelo['nudos']))
for n in modelo['nudos']:
    print('  N%s: (%s, %s) apoyo=%s' % (n['id'], n['x'], n['y'], n.get('apoyo','')))
print('Elementos:', len(modelo['elementos']))
for e in modelo['elementos']:
    print('  E%s: N%s->N%s seccion=%s' % (e['id'], e['i'], e['j'], e.get('seccion','?')))
print('Secciones:', json.dumps(modelo.get('secciones', []), indent=2))

print('\n=== CARGAS ===')
for ce in modelo.get('cargas_elementos', []):
    print('  Elem %s: %s' % (ce['elem'], json.dumps(ce)))

from core.constructor import construir, extraer_resultados

print('\n=== RUNNING BACKEND ===')
try:
    est = construir(modelo)
    
    print('\nElement properties:')
    for e in est.elementos:
        print('  E%d: L=%.4f, angle=%.4f deg, cos=%.4f, sin=%.4f' % (e.id, e.L, e.angulo*180/3.14159, e.cos, e.sin))
        print('    A=%.6f, I=%.6f' % (e.sec.A, e.sec.I))
        print('    E=%.0f' % e.mat.E)
        for c in e.cargas:
            print('    Carga: type=%s' % type(c).__name__)
            if hasattr(c, 'wx'):
                print('      wx=%.4f, wy=%.4f, a=%s, b=%s' % (c.wx, c.wy, c.a, c.b))
            if hasattr(c, 'Px'):
                print('      Px=%.4f, Py=%.4f, a=%s' % (c.Px, c.Py, c.a))
    
    est.resolver()
    res = extraer_resultados(est)
    
    print('\n=== RESUMEN ===')
    for k, v in res['resumen'].items():
        print('  %s: %s' % (k, v))
    
    print('\n=== EQUILIBRIO ===')
    print('  Type:', type(res['equilibrio']))
    eq = res['equilibrio']
    if isinstance(eq, dict):
        for k, v in eq.items():
            print('  %s: %s' % (k, v))
    elif isinstance(eq, list):
        for item in eq:
            print('  %s' % item)
    else:
        print('  %s' % eq)
    
    print('\n=== REACCIONES ===')
    for r in res['reacciones']:
        print('  %s: Rx=%.4f, Ry=%.4f, M=%.4f' % (r['nudo'], r['Rx'], r['Ry'], r['M']))
    
    print('\n=== DESPLAZAMIENTOS ===')
    for d in res['desplazamientos']:
        print('  %s: ux=%.6f, uy=%.6f, giro=%.6f, restr=%s' % (d['nudo'], d['ux'], d['uy'], d['giro'], d['restringido']))
    
    print('\n=== FUERZAS INTERNAS ===')
    for f in res['fuerzas']:
        print('  %s: Ni=%.4f Vi=%.4f Mi=%.4f | Nj=%.4f Vj=%.4f Mj=%.4f' % (f['elem'], f['Ni'], f['Vi'], f['Mi'], f['Nj'], f['Vj'], f['Mj']))
        print('    Mmax=%.4f @ x=%.4f | Vmax=%.4f @ x=%.4f' % (f['Mmax'], f['xMmax'], f['Vmax'], f['xVmax']))
    
    print('\n=== DIAGRAMAS (M, V, N por elemento) ===')
    for dk in ['M', 'V', 'N']:
        print('\n--- %s ---' % dk)
        for i, d in enumerate(res['diagramas']['elementos']):
            vals = d[dk]
            if vals:
                print('  %s: min=%.4f max=%.4f' % (d['elem'], min(vals), max(vals)))
                # Print all values for detailed comparison
                formatted = ['%.4f' % v for v in vals]
                for j in range(0, len(formatted), 10):
                    print('    [%d-%d]: %s' % (j, min(j+9, len(formatted)-1), ', '.join(formatted[j:j+10])))

except Exception as ex:
    import traceback
    traceback.print_exc()
    print('ERROR:', ex)
