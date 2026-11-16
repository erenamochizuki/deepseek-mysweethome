// Quarter-unit shell profile shared by the web and Minecraft collectible model.
(function (V3) {
  'use strict';

  // Each terrace lists [x0, z0, x1, z1, inner?] rectangles with disjoint interiors.
  // The heel is broad in the west; the narrower east end bends north. The
  // underside flares outward in low terraces instead of dropping straight down.
  const terraces = [
    [0, .5, [
      [6, 5.5, 10, 11],
      [10, 5.5, 11.5, 9.5],
      [4.5, 6.75, 6, 9.5],
      [5.5, 9.5, 6, 11],
    ]],
    [.5, 1.25, [
      [8, 4.25, 12.25, 5],
      [4.25, 5, 11.75, 11.25, 'up'],
      [11.75, 5, 13.5, 9.75, 'up'],
      [3, 6, 4.25, 9.75],
      [5.5, 11.25, 10, 12],
    ]],
    // Leave a smaller opening here than at the lip, exposing a nacre shelf
    // around the low floor. The inward face is a painter hint, not a cutout.
    [1.25, 2.25, [
      [8, 4, 12.25, 4.25],
      [12.25, 4, 13.5, 10.25, 'west'],
      [5.5, 4.25, 12.25, 5.5, 'south'],
      [13.5, 4.25, 14, 5],
      [3.5, 5, 4.5, 6],
      [4.5, 5, 5.5, 6.75, 'south'],
      [13.5, 5, 14.5, 8.75],
      [5.5, 5.5, 6, 6.75, 'east'],
      [11.5, 5.5, 12.25, 6.75, 'west'],
      [2.25, 6, 4.5, 10.25, 'east'],
      [4.5, 9.5, 5.5, 12, 'north'],
      [10, 9.5, 12.25, 11.25, 'north'],
      [3.25, 10.25, 4.5, 11.25],
      [5.5, 10.5, 10, 12.75, 'north'],
      [4.25, 11.25, 4.5, 12],
      [10, 11.25, 11, 12],
    ]],
  ];

  // Lip rectangles [x0, z0, x1, z1, y1, inner?] all start at y=2.25.
  // The north edge is higher than the heel and the south edge. Four full
  // apertures are bounded on all four sides in the common lip layer:
  //   [4.25, 5] × [4, 4.75], [6.5, 7.5] × [3.5, 4.25],
  //   [8.75, 9.75] × [3, 4], [11, 12] × [3.25, 4].
  // No lower terrace fills those vertical shafts.
  const lip = [
    [8, 2.5, 9.75, 3, 3.5],
    [9.75, 2.5, 11, 4.5, 3.5, 'south'],
    [11, 2.5, 11.75, 3.25, 3.5],
    [6, 3, 7.5, 3.5, 3.25],
    [7.5, 3, 8.75, 4.5, 3.5, 'south'],
    [11.75, 3, 12, 3.25, 3.5],
    [12, 3, 12.5, 4.5, 3.25, 'south'],
    [4.25, 3.5, 5, 4, 3.25],
    [5, 3.5, 6.5, 5.5, 3.25, 'south'],
    [12.5, 3.5, 13.5, 5.5, 3, 'south'],
    [4, 3.75, 4.25, 4.25, 3.25],
    [8.75, 4, 9.75, 4.5, 3.5, 'south'],
    [11, 4, 12, 4.5, 3.5, 'south'],
    [3.5, 4.25, 4.25, 4.75, 3.25],
    [6.5, 4.25, 7.5, 5.5, 3.25, 'south'],
    [13.5, 4.25, 14, 6.5, 3, 'west'],
    [14, 4.25, 14.5, 5, 2.75],
    [3.5, 4.75, 5, 6.5, 3.25, 'south'],
    [2.25, 5, 3.25, 11.25, 3, 'east'],
    [3.25, 5, 3.5, 6.5, 3, 'south'],
    [14, 5, 15, 8.75, 2.75, 'west'],
    [1.5, 6, 2.25, 10.25, 3],
    // Overlapping runs in projection keep the curving east lip joined by
    // actual faces, not just corners between successive z terraces.
    [13.25, 8.25, 14, 8.75, 2.75, 'west'],
    [12.75, 8.75, 13.5, 10.25, 3, 'west'],
    [12, 9.75, 12.75, 10.25, 2.75, 'west'],
    [3.25, 10.25, 4.25, 12, 2.75, 'north'],
    [11.25, 10.25, 12.25, 11.25, 2.75, 'north'],
    [4.25, 11.25, 5.5, 12.75, 2.75, 'north'],
    [9.75, 11.25, 11, 12, 2.75, 'north'],
    [5.5, 12, 8.75, 13.25, 2.75, 'north'],
    [8.75, 12, 10, 12.75, 2.75, 'north'],
  ];

  function part(x0, y0, z0, x1, y1, z1, inner, rim) {
    return {
      from: [x0, y0, z0],
      to: [x1, y1, z1],
      ...(inner ? { inner } : {}),
      ...(rim ? { rim: true } : {}),
    };
  }

  function parts() {
    const body = terraces.flatMap(([y0, y1, rectangles]) => rectangles.map(
      ([x0, z0, x1, z1, inner]) => part(x0, y0, z0, x1, y1, z1, inner),
    ));
    return body.concat(lip.map(([x0, z0, x1, z1, y1, inner]) =>
      part(x0, 2.25, z0, x1, y1, z1, inner, true)));
  }

  V3.abaloneContour = { parts };
})(window.V3);
