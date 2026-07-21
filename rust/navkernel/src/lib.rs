use std::cmp::Ordering;
use std::collections::BinaryHeap;
use std::collections::HashMap;

const CELL: f64 = 200.0;
const PORTAL_SNAP: f64 = 24.0;
const STRAIGHT_MIN: f64 = 0.0;
const Z_WEIGHT: f64 = 0.4;
const STEP_Z_WEIGHT: f64 = 0.5;

struct Area {
    id: i32,
    nw: [f64; 3],
    se: [f64; 3],
    weight: f64,
    conn_start: u32,
    conn_len: u32,
}

impl Area {
    fn center(&self) -> [f64; 3] {
        [
            (self.nw[0] + self.se[0]) * 0.5,
            (self.nw[1] + self.se[1]) * 0.5,
            (self.nw[2] + self.se[2]) * 0.5,
        ]
    }
    fn contains(&self, x: f64, y: f64) -> bool {
        x >= self.nw[0] && x <= self.se[0] && y >= self.nw[1] && y <= self.se[1]
    }
}

struct Field {
    dist: Vec<f64>,
    next: Vec<i32>,
}

struct Grid {
    min_x: f64,
    min_y: f64,
    cols: usize,
    rows: usize,
    cells: Vec<Vec<u32>>,
}

impl Grid {
    fn build(areas: &[Area]) -> Grid {
        let mut min_x = f64::INFINITY;
        let mut min_y = f64::INFINITY;
        let mut max_x = f64::NEG_INFINITY;
        let mut max_y = f64::NEG_INFINITY;
        for a in areas {
            min_x = min_x.min(a.nw[0]);
            min_y = min_y.min(a.nw[1]);
            max_x = max_x.max(a.se[0]);
            max_y = max_y.max(a.se[1]);
        }
        if !min_x.is_finite() {
            return Grid { min_x: 0.0, min_y: 0.0, cols: 1, rows: 1, cells: vec![Vec::new()] };
        }
        let cols = (((max_x - min_x) / CELL).ceil() as usize + 1).max(1);
        let rows = (((max_y - min_y) / CELL).ceil() as usize + 1).max(1);
        let mut cells = vec![Vec::new(); cols * rows];
        for (i, a) in areas.iter().enumerate() {
            let c0 = ((a.nw[0] - min_x) / CELL).floor().max(0.0) as usize;
            let c1 = (((a.se[0] - min_x) / CELL).floor().max(0.0) as usize).min(cols - 1);
            let r0 = ((a.nw[1] - min_y) / CELL).floor().max(0.0) as usize;
            let r1 = (((a.se[1] - min_y) / CELL).floor().max(0.0) as usize).min(rows - 1);
            for r in r0..=r1.min(rows - 1) {
                for c in c0..=c1.min(cols - 1) {
                    if r * cols + c < cells.len() {
                        cells[r * cols + c].push(i as u32);
                    }
                }
            }
        }
        Grid { min_x, min_y, cols, rows, cells }
    }

    fn cell_of(&self, x: f64, y: f64) -> Option<usize> {
        let c = ((x - self.min_x) / CELL).floor();
        let r = ((y - self.min_y) / CELL).floor();
        if c < 0.0 || r < 0.0 {
            return None;
        }
        let (c, r) = (c as usize, r as usize);
        if c >= self.cols || r >= self.rows {
            return None;
        }
        Some(r * self.cols + c)
    }
}

struct Nav {
    areas: Vec<Area>,
    conns: Vec<u32>,
    rev_start: Vec<u32>,
    rev: Vec<u32>,
    id_of_index: Vec<i32>,
    index_of_id: Vec<i32>,
    grid: Grid,
    fields: Vec<(i32, Field)>,
    field_index: HashMap<i32, usize>,
}

static mut NAV: Option<Nav> = None;

fn nav() -> Option<&'static mut Nav> {
    unsafe {
        let p = &raw mut NAV;
        (*p).as_mut()
    }
}

#[derive(PartialEq)]
struct HeapItem(f64, u32);

impl Eq for HeapItem {}

impl Ord for HeapItem {
    fn cmp(&self, other: &Self) -> Ordering {
        other.0.partial_cmp(&self.0).unwrap_or(Ordering::Equal).then_with(|| other.1.cmp(&self.1))
    }
}

impl PartialOrd for HeapItem {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl Nav {
    fn index(&self, id: i32) -> Option<usize> {
        if id < 0 {
            return None;
        }
        let i = id as usize;
        if i >= self.index_of_id.len() {
            return None;
        }
        let idx = self.index_of_id[i];
        if idx < 0 {
            None
        } else {
            Some(idx as usize)
        }
    }

    fn neighbors(&self, idx: usize) -> &[u32] {
        let a = &self.areas[idx];
        let s = a.conn_start as usize;
        &self.conns[s..s + a.conn_len as usize]
    }

    fn nearest(&self, x: f64, y: f64, z: f64) -> i32 {
        let flat = !(z == z);
        if flat {
            if let Some(cell) = self.grid.cell_of(x, y) {
                for &ai in &self.grid.cells[cell] {
                    let a = &self.areas[ai as usize];
                    if a.contains(x, y) {
                        return a.id;
                    }
                }
            }
        }
        let mut best = -1i32;
        let mut best_d = f64::INFINITY;
        let consider = |a: &Area, best: &mut i32, best_d: &mut f64| {
            let cx = if x < a.nw[0] { a.nw[0] } else if x > a.se[0] { a.se[0] } else { x };
            let cy = if y < a.nw[1] { a.nw[1] } else if y > a.se[1] { a.se[1] } else { y };
            let dz = if flat { 0.0 } else { (a.nw[2] + a.se[2]) * 0.5 - z };
            let ddx = cx - x;
            let ddy = cy - y;
            let d = ddx * ddx + ddy * ddy + dz * dz * Z_WEIGHT;
            if d < *best_d {
                *best_d = d;
                *best = a.id;
            }
        };
        let mut ring = 0usize;
        loop {
            let mut found_any = false;
            if let Some(base) = self.grid.cell_of(x, y) {
                let bc = base % self.grid.cols;
                let br = base / self.grid.cols;
                let c0 = bc.saturating_sub(ring);
                let r0 = br.saturating_sub(ring);
                let c1 = (bc + ring).min(self.grid.cols - 1);
                let r1 = (br + ring).min(self.grid.rows - 1);
                for r in r0..=r1 {
                    for c in c0..=c1 {
                        if ring > 0 && r > r0 && r < r1 && c > c0 && c < c1 {
                            continue;
                        }
                        for &ai in &self.grid.cells[r * self.grid.cols + c] {
                            found_any = true;
                            consider(&self.areas[ai as usize], &mut best, &mut best_d);
                        }
                    }
                }
            }
            let span = (ring as f64) * CELL;
            if best >= 0 && span * span >= best_d {
                return best;
            }
            if ring > self.grid.cols.max(self.grid.rows) {
                break;
            }
            if !found_any && best < 0 && ring > 4 && self.grid.cell_of(x, y).is_none() {
                break;
            }
            ring += 1;
        }
        if best >= 0 {
            return best;
        }
        for a in &self.areas {
            consider(a, &mut best, &mut best_d);
        }
        best
    }

    fn area_at(&self, x: f64, y: f64, z: f64, hint: i32) -> i32 {
        if let Some(hi) = self.index(hint) {
            if self.areas[hi].contains(x, y) {
                return self.areas[hi].id;
            }
            for &n in self.neighbors(hi) {
                if let Some(ni) = self.index(n as i32) {
                    if self.areas[ni].contains(x, y) {
                        return self.areas[ni].id;
                    }
                }
            }
        }
        self.nearest(x, y, z)
    }

    fn field_pos(&self, target: i32) -> Option<usize> {
        self.field_index.get(&target).copied()
    }

    fn ensure_field(&mut self, target: i32) -> Option<usize> {
        if let Some(p) = self.field_pos(target) {
            return Some(p);
        }
        let ti = self.index(target)?;
        let n = self.areas.len();
        let mut dist = vec![f64::INFINITY; n];
        let mut heap = BinaryHeap::new();
        dist[ti] = 0.0;
        heap.push(HeapItem(0.0, ti as u32));
        while let Some(HeapItem(d, cur)) = heap.pop() {
            let cur = cur as usize;
            if d > dist[cur] {
                continue;
            }
            let cc = self.areas[cur].center();
            let s = self.rev_start[cur] as usize;
            let e = self.rev_start[cur + 1] as usize;
            for k in s..e {
                let p = self.rev[k] as usize;
                let pc = self.areas[p].center();
                let dx = pc[0] - cc[0];
                let dy = pc[1] - cc[1];
                let step = (dx * dx + dy * dy).sqrt() + (pc[2] - cc[2]).abs() * STEP_Z_WEIGHT;
                let nd = d + step * self.areas[p].weight;
                if nd < dist[p] {
                    dist[p] = nd;
                    heap.push(HeapItem(nd, p as u32));
                }
            }
        }
        let field = Field { dist, next: vec![i32::MIN; n] };
        self.fields.push((target, field));
        let pos = self.fields.len() - 1;
        self.field_index.insert(target, pos);
        Some(pos)
    }

    fn next_toward(&mut self, target: i32, area: i32) -> i32 {
        let fp = match self.ensure_field(target) {
            Some(p) => p,
            None => return -1,
        };
        let ai = match self.index(area) {
            Some(a) => a,
            None => return -1,
        };
        let cached = self.fields[fp].1.next[ai];
        if cached != i32::MIN {
            return cached;
        }
        let here = self.fields[fp].1.dist[ai];
        let mut best = -1i32;
        let mut best_d = here;
        let s = self.areas[ai].conn_start as usize;
        let len = self.areas[ai].conn_len as usize;
        for k in s..s + len {
            let nid = self.conns[k] as i32;
            if let Some(ni) = self.index(nid) {
                let d = self.fields[fp].1.dist[ni];
                if d.is_finite() && d < best_d {
                    best_d = d;
                    best = nid;
                }
            }
        }
        self.fields[fp].1.next[ai] = best;
        best
    }

    fn portal(&self, a: i32, b: i32) -> Option<[f64; 2]> {
        let ai = self.index(a)?;
        let bi = self.index(b)?;
        let a = &self.areas[ai];
        let b = &self.areas[bi];
        let x1 = a.nw[0].max(b.nw[0]);
        let x2 = a.se[0].min(b.se[0]);
        let y1 = a.nw[1].max(b.nw[1]);
        let y2 = a.se[1].min(b.se[1]);
        Some([(x1 + x2) * 0.5, (y1 + y2) * 0.5])
    }
}

static mut OUT: [f64; 8] = [0.0; 8];

#[no_mangle]
pub extern "C" fn out_ptr() -> *const f64 {
    (&raw const OUT) as *const f64
}

#[no_mangle]
pub extern "C" fn alloc(len: usize) -> *mut u8 {
    let mut v = Vec::<u8>::with_capacity(len);
    let p = v.as_mut_ptr();
    std::mem::forget(v);
    p
}

#[no_mangle]
pub extern "C" fn nav_build(
    areas_ptr: *const f64,
    area_count: usize,
    conns_ptr: *const i32,
    conns_len: usize,
) -> i32 {
    let vals = unsafe { std::slice::from_raw_parts(areas_ptr, area_count * 10) };
    let conn_in = unsafe { std::slice::from_raw_parts(conns_ptr, conns_len) };
    let mut areas = Vec::with_capacity(area_count);
    let mut max_id = 0i32;
    for i in 0..area_count {
        let b = i * 10;
        let id = vals[b] as i32;
        max_id = max_id.max(id);
        areas.push(Area {
            id,
            nw: [vals[b + 1], vals[b + 2], vals[b + 3]],
            se: [vals[b + 4], vals[b + 5], vals[b + 6]],
            weight: vals[b + 7],
            conn_start: vals[b + 8] as u32,
            conn_len: vals[b + 9] as u32,
        });
    }
    let mut index_of_id = vec![-1i32; (max_id as usize) + 2];
    for (i, a) in areas.iter().enumerate() {
        index_of_id[a.id as usize] = i as i32;
    }
    let conns: Vec<u32> = conn_in.iter().map(|&v| v as u32).collect();

    let mut rev_counts = vec![0u32; areas.len() + 1];
    for (i, a) in areas.iter().enumerate() {
        let _ = i;
        let s = a.conn_start as usize;
        for k in s..s + a.conn_len as usize {
            let nid = conns[k] as i32;
            if nid >= 0 && (nid as usize) < index_of_id.len() {
                let ni = index_of_id[nid as usize];
                if ni >= 0 {
                    rev_counts[ni as usize + 1] += 1;
                }
            }
        }
    }
    for i in 1..rev_counts.len() {
        rev_counts[i] += rev_counts[i - 1];
    }
    let rev_start = rev_counts.clone();
    let mut cursor = rev_counts;
    let mut rev = vec![0u32; rev_start[areas.len()] as usize];
    for (i, a) in areas.iter().enumerate() {
        let s = a.conn_start as usize;
        for k in s..s + a.conn_len as usize {
            let nid = conns[k] as i32;
            if nid >= 0 && (nid as usize) < index_of_id.len() {
                let ni = index_of_id[nid as usize];
                if ni >= 0 {
                    let slot = cursor[ni as usize] as usize;
                    rev[slot] = i as u32;
                    cursor[ni as usize] += 1;
                }
            }
        }
    }

    let grid = Grid::build(&areas);
    let id_of_index = areas.iter().map(|a| a.id).collect();
    unsafe {
        let p = &raw mut NAV;
        *p = Some(Nav {
            areas,
            conns,
            rev_start,
            rev,
            id_of_index,
            index_of_id,
            grid,
            fields: Vec::new(),
            field_index: HashMap::new(),
        });
    }
    1
}

#[no_mangle]
pub extern "C" fn nav_area_count() -> i32 {
    nav().map(|n| n.id_of_index.len() as i32).unwrap_or(0)
}

#[no_mangle]
pub extern "C" fn nav_area_at(x: f64, y: f64, z: f64, hint: i32) -> i32 {
    match nav() {
        Some(n) => n.area_at(x, y, z, hint),
        None => -1,
    }
}

#[no_mangle]
pub extern "C" fn nav_nearest(x: f64, y: f64, z: f64) -> i32 {
    match nav() {
        Some(n) => n.nearest(x, y, z),
        None => -1,
    }
}

#[no_mangle]
pub extern "C" fn nav_next_toward(target: i32, area: i32) -> i32 {
    match nav() {
        Some(n) => n.next_toward(target, area),
        None => -1,
    }
}

#[no_mangle]
pub extern "C" fn nav_field_dist(target: i32, area: i32) -> f64 {
    let n = match nav() {
        Some(n) => n,
        None => return f64::INFINITY,
    };
    let fp = match n.ensure_field(target) {
        Some(p) => p,
        None => return f64::INFINITY,
    };
    match n.index(area) {
        Some(ai) => n.fields[fp].1.dist[ai],
        None => f64::INFINITY,
    }
}

#[no_mangle]
pub extern "C" fn nav_field_by_id(target: i32, out: *mut f64, cap: usize) -> i32 {
    let n = match nav() {
        Some(n) => n,
        None => return 0,
    };
    let fp = match n.ensure_field(target) {
        Some(p) => p,
        None => return 0,
    };
    let buf = unsafe { std::slice::from_raw_parts_mut(out, cap) };
    for v in buf.iter_mut() {
        *v = f64::INFINITY;
    }
    for (i, &id) in n.id_of_index.iter().enumerate() {
        if id >= 0 && (id as usize) < cap {
            buf[id as usize] = n.fields[fp].1.dist[i];
        }
    }
    1
}

#[no_mangle]
pub extern "C" fn nav_max_id() -> i32 {
    match nav() {
        Some(n) => n.id_of_index.iter().copied().max().unwrap_or(-1),
        None => -1,
    }
}

#[no_mangle]
pub extern "C" fn nav_center(area: i32) -> i32 {
    let n = match nav() {
        Some(n) => n,
        None => return 0,
    };
    match n.index(area) {
        Some(ai) => {
            let c = n.areas[ai].center();
            unsafe {
                let p = &raw mut OUT;
                (*p)[0] = c[0];
                (*p)[1] = c[1];
                (*p)[2] = c[2];
            }
            1
        }
        None => 0,
    }
}

#[no_mangle]
pub extern "C" fn nav_portal(a: i32, b: i32) -> i32 {
    let n = match nav() {
        Some(n) => n,
        None => return 0,
    };
    match n.portal(a, b) {
        Some(p) => {
            unsafe {
                let o = &raw mut OUT;
                (*o)[0] = p[0];
                (*o)[1] = p[1];
            }
            1
        }
        None => 0,
    }
}

fn write_actor(x: f64, y: f64, z: f64, area: i32, ret: f64) {
    unsafe {
        let o = &raw mut OUT;
        (*o)[0] = x;
        (*o)[1] = y;
        (*o)[2] = z;
        (*o)[3] = area as f64;
        (*o)[4] = ret;
    }
}

#[no_mangle]
pub extern "C" fn move_along(
    px: f64,
    py: f64,
    pz: f64,
    area: i32,
    tx: f64,
    ty: f64,
    tz: f64,
    dt: f64,
    speed: f64,
) -> f64 {
    let n = match nav() {
        Some(n) => n,
        None => {
            write_actor(px, py, pz, area, 0.0);
            return 0.0;
        }
    };
    let dx0 = tx - px;
    let dy0 = ty - py;
    let straight = (dx0 * dx0 + dy0 * dy0).sqrt();
    let mut wx = tx;
    let mut wy = ty;
    if straight > STRAIGHT_MIN && area >= 0 {
        let t_area = n.area_at(tx, ty, tz, -1);
        if t_area >= 0 && t_area != area {
            let next = n.next_toward(t_area, area);
            if next >= 0 {
                if let Some(p) = n.portal(area, next) {
                    wx = p[0];
                    wy = p[1];
                }
            }
        }
    }
    let dx = wx - px;
    let dy = wy - py;
    let mut d = (dx * dx + dy * dy).sqrt();
    if d == 0.0 {
        d = 1.0;
    }
    let step_len = d.min(speed * dt);
    let nx = px + dx / d * step_len;
    let ny = py + dy / d * step_len;
    let na = n.area_at(nx, ny, f64::NAN, area);
    let (fa, fz) = if na >= 0 {
        let ai = n.index(na).unwrap();
        (na, (n.areas[ai].nw[2] + n.areas[ai].se[2]) * 0.5)
    } else {
        (area, pz)
    };
    write_actor(nx, ny, fz, fa, straight);
    straight
}

#[no_mangle]
pub extern "C" fn move_field(
    px: f64,
    py: f64,
    pz: f64,
    area: i32,
    target: i32,
    tx: f64,
    ty: f64,
    tz: f64,
    dt: f64,
    speed: f64,
) -> f64 {
    let n = match nav() {
        Some(n) => n,
        None => return move_along(px, py, pz, area, tx, ty, tz, dt, speed),
    };
    if area < 0 {
        return move_along(px, py, pz, area, tx, ty, tz, dt, speed);
    }
    let t_area = n.area_at(tx, ty, tz, -1);
    if t_area >= 0 && t_area == area {
        return move_along(px, py, pz, area, tx, ty, tz, dt, speed);
    }
    let next = n.next_toward(target, area);
    if next < 0 {
        return move_along(px, py, pz, area, tx, ty, tz, dt, speed);
    }
    let p = match n.portal(area, next) {
        Some(p) => p,
        None => {
            let ni = match n.index(next) {
                Some(i) => i,
                None => return move_along(px, py, pz, area, tx, ty, tz, dt, speed),
            };
            let c = n.areas[ni].center();
            [c[0], c[1]]
        }
    };
    let mut cur_area = area;
    let mut dx = p[0] - px;
    let mut dy = p[1] - py;
    let mut d = (dx * dx + dy * dy).sqrt();
    if d < PORTAL_SNAP {
        cur_area = next;
        let ni = n.index(next);
        if let Some(ni) = ni {
            let c = n.areas[ni].center();
            dx = c[0] - px;
            dy = c[1] - py;
            d = (dx * dx + dy * dy).sqrt();
            if d == 0.0 {
                d = 1.0;
            }
        }
    }
    let dd = if d == 0.0 { 1.0 } else { d };
    let step_len = speed * dt;
    let nx = px + dx / dd * step_len.min(d);
    let ny = py + dy / dd * step_len.min(d);
    let na = n.area_at(nx, ny, f64::NAN, cur_area);
    let (fa, fz) = if na >= 0 {
        let ai = n.index(na).unwrap();
        (na, (n.areas[ai].nw[2] + n.areas[ai].se[2]) * 0.5)
    } else {
        (cur_area, pz)
    };
    let rdx = tx - nx;
    let rdy = ty - ny;
    let ret = (rdx * rdx + rdy * rdy).sqrt();
    write_actor(nx, ny, fz, fa, ret);
    ret
}
