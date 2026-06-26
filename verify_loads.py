# -*- coding: utf-8 -*-
"""Verify load conversions for the hyperstatic frame"""
import math

print('=== LOAD CONVERSION VERIFICATION ===')
print('Unit: kN_m -> Backend converts kN to tonf via 1/9.81')
print()

# E1: Column N1(0,0)->N2(0,8), dir=perp, q=-20
# For vertical element (dx=0, dy=8): cos=0, sin=1
# perp = (-sin, cos) = (-1, 0)  -> horizontal to the LEFT
# But q=-20, so force = q * perp = -20 * (-1, 0) = (20, 0) -> horizontal to the RIGHT
# Wait, that's wrong. perp = (-cy, cx) = (-sin, cos) = (-1, 0)
# So wx = q * (-1) = -20 * (-1) = 20, wy = q * 0 = 0
# In tonf: wx = 20/9.81 = 2.039 tonf/m, wy = 0

print('E1: Column N1(0,0)->N2(0,8)')
print('  L=8m, dx=0, dy=8, cos=0, sin=1')
print('  perp direction: (-sin, cos) = (-1, 0) -> horizontal LEFT')
print('  q=-20 kN/m')
print('  wx = q * (-sin) = -20 * (-1) = 20 kN/m')
print('  wy = q * cos = -20 * 0 = 0 kN/m')
print('  In tonf: wx = 20/9.81 = %.4f tonf/m' % (20/9.81))
print('  RESULT: 2.039 tonf/m horizontal -> E1 Ni.Vi=11.572, Ni.Ni=-4.558')
print('  V=sin(90)*wx+cos(90)*wy = 1*2.039+0*0 = 2.039... wait')
print()
print('  But wait: perp=(-cy, cx)=(-sin, cos)=(-1, 0) means direction is LEFT')
print('  q=-20 means load magnitude is 20 kN/m OPPOSITE to perp direction')
print('  So load points RIGHT (+x)')
print('  wx = -20 * (-1) = 20 kN/m (RIGHT in global)')
print('  After unit conversion: wx = 20/9.81 = 2.039 tonf/m')
print('  For vertical element, local shear V = wx = 2.039 tonf/m... no')
print()

# Actually let me trace through what the element-local system does
# Element E1 goes from (0,0) to (0,8): vertical column
# Local axis: x along element (upward), y perpendicular (to the left)
# cos=0, sin=1
# 
# The perpendicular direction for loads:
# perp = (-sin, cos) = (-1, 0) -> this is to the LEFT in global coords
# That's the NEGATIVE local y direction (since local y = (-sin, cos) = LEFT)
# 
# So perp load with q=-20:
# wx = q * (-sin) = -20 * (-1) = 20 kN/m (global X direction, RIGHT)
# wy = q * cos = -20 * 0 = 0
#
# In the backend, these are the GLOBAL wx, wy
# But the backend stores them as LOCAL components:
# Local wx = cos*wx_global + sin*wy_global = 0*20 + 1*0 = 0
# Local wy = -sin*wx_global + cos*wy_global = -1*20 + 0*0 = -20
# 
# Wait, the CargaDistribuida stores wx, wy as... let me check what the code does.

print('=== CHECKING CODE FLOW ===')
print('construir() calls _resolve_dir() which computes wx, wy from dir/q')
print('Then CargaDistribuida(wx=..., wy=...) is created')
print('The question is: are wx/wy in GLOBAL or LOCAL coords?')
print()
print('Looking at the backend:')
print('  _resolve_dir computes: wx = q * ux, wy = q * uy where (ux,uy) is the direction vector')
print('  For perp on vertical column: (ux,uy) = (-sin, cos) = (-1, 0)')
print('  So wx = -20 * (-1) = 20, wy = -20 * 0 = 0')
print()
print('  Then CargaDistribuida(wx=20, wy=0) is created')
print('  AFTER unit conversion: wx = 20/9.81 = 2.039, wy = 0')
print()
print('The CargaDistribuida class needs to know if these are local or global.')
print('Let me check metodo_rigidez.py...')
