import type { BufferGeometry } from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * PolyhedronGeometry is non-indexed. Recomputing normals after CPU deformation
 * would therefore assign one flat normal per triangle, even when the material
 * has flatShading disabled. These procedural moons do not use UVs, so weld the
 * coincident positions first and let shared vertices receive averaged normals.
 */
export function weldProceduralMoonGeometry(geometry: BufferGeometry): BufferGeometry {
  geometry.deleteAttribute('uv');
  geometry.deleteAttribute('normal');

  const welded = mergeVertices(geometry, 1e-5);
  welded.computeVertexNormals();
  welded.computeBoundingSphere();
  return welded;
}
