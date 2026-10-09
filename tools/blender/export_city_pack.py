# Export each asset of a Blender city pack to its own GLB for js/cityDressing.js.
#
#   blender -b assets/city-real/src/city-pack.blend \
#     --python tools/blender/export_city_pack.py -- assets/city-real
#
# Every mesh is exported with its modifiers applied, moved so its footprint is
# centred on the origin with its base at y=0, and its textures downscaled to at
# most MAX_TEX px and re-encoded as JPEG. Writes <out>/<collection>/<name>.glb
# and <out>/manifest.json (size and triangle count per model).
import bpy, sys, os, json
from mathutils import Vector

MAX_TEX = 1024
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = os.path.abspath(argv[0] if argv else 'assets/city-real')
SKIP_COLLECTIONS = {'Pipes', 'Roads'}       # kitbash bits and road tiles the circuit already has

# Triangle budget per collection. A street repeats each model dozens of times,
# so the source meshes (up to 68k triangles after modifiers) are reduced:
# first coplanar faces are merged (no visible change on flat facades), then a
# collapse decimate brings anything still over budget down to it.
BUDGET = {'Buildings': 5000, 'Shops': 1500, 'Extras': 1500, 'Road_sign': 400, 'Traffic_light': 3000}
HEAVY_BUDGET = 9000                          # the large back-row blocks
HEAVY = {'building_1', 'building_3', 'building_8', 'building_9'}


def tri_count(obj):
    ev = obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
    me = ev.to_mesh()
    n = sum(len(p.vertices) - 2 for p in me.polygons)
    ev.to_mesh_clear()
    return n


def fit_budget(obj, budget):
    """Append decimation so the evaluated mesh lands at or under `budget`."""
    if tri_count(obj) <= budget:
        return
    planar = obj.modifiers.new('fit_planar', 'DECIMATE')
    planar.decimate_type = 'DISSOLVE'
    planar.angle_limit = 0.0175           # 1 degree
    planar.use_dissolve_boundaries = False
    planar.delimit = {'UV', 'MATERIAL'}
    n = tri_count(obj)
    if n > budget:
        collapse = obj.modifiers.new('fit_collapse', 'DECIMATE')
        collapse.decimate_type = 'COLLAPSE'
        collapse.ratio = budget / n
        collapse.use_collapse_triangulate = True

# downscale every texture once (they are packed in the .blend)
for im in bpy.data.images:
    if im.size[0] == 0:
        continue
    w, h = im.size
    k = MAX_TEX / max(w, h)
    if k < 1:
        im.scale(max(1, int(w * k)), max(1, int(h * k)))

depsgraph = bpy.context.evaluated_depsgraph_get()
manifest = {}
for coll in bpy.data.collections:
    if coll.name in SKIP_COLLECTIONS:
        continue
    folder = os.path.join(OUT, coll.name.lower())
    os.makedirs(folder, exist_ok=True)
    for obj in coll.objects:
        if obj.type != 'MESH':
            continue
        name0 = obj.name.lower().replace(' ', '_')
        fit_budget(obj, HEAVY_BUDGET if name0 in HEAVY else BUDGET.get(coll.name, 5000))
        depsgraph = bpy.context.evaluated_depsgraph_get()
        # world-space bounds of the evaluated (modifier-applied) mesh
        ev = obj.evaluated_get(depsgraph)
        corners = [obj.matrix_world @ Vector(c) for c in ev.bound_box]
        mn = Vector((min(c.x for c in corners), min(c.y for c in corners), min(c.z for c in corners)))
        mx = Vector((max(c.x for c in corners), max(c.y for c in corners), max(c.z for c in corners)))
        shift = Vector(((mn.x + mx.x) / 2, (mn.y + mx.y) / 2, mn.z))
        saved = obj.matrix_world.copy()
        obj.matrix_world.translation -= shift
        bpy.ops.object.select_all(action='DESELECT')
        obj.hide_set(False)
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        name = obj.name.lower().replace(' ', '_')
        path = os.path.join(folder, name + '.glb')
        bpy.ops.export_scene.gltf(
            filepath=path, export_format='GLB', use_selection=True,
            export_apply=True, export_image_format='JPEG', export_jpeg_quality=82,
            export_yup=True, export_cameras=False, export_lights=False,
            export_animations=False, export_extras=False,
        )
        obj.matrix_world = saved
        ev = obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
        me = ev.to_mesh()
        tris = sum(len(p.vertices) - 2 for p in me.polygons)
        ev.to_mesh_clear()
        size = mx - mn
        manifest[f'{coll.name.lower()}/{name}'] = {
            'w': round(size.x, 2), 'd': round(size.y, 2), 'h': round(size.z, 2),
            'tris': tris, 'bytes': os.path.getsize(path),
        }
        print('EXPORTED', coll.name, name, tris)

with open(os.path.join(OUT, 'manifest.json'), 'w') as f:
    json.dump(manifest, f, indent=1)
print('DONE', len(manifest))
