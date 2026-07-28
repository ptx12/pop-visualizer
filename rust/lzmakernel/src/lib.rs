static mut SRC: Vec<u8> = Vec::new();
static mut OUT: Vec<u8> = Vec::new();

fn src_buf() -> &'static mut Vec<u8> {
    unsafe { &mut *(&raw mut SRC) }
}

fn out_buf() -> &'static mut Vec<u8> {
    unsafe { &mut *(&raw mut OUT) }
}

#[no_mangle]
pub extern "C" fn reserve(src_len: usize, out_len: usize) -> *mut u8 {
    let s = src_buf();
    if s.len() < src_len {
        s.resize(src_len, 0);
    }
    let o = out_buf();
    if o.len() < out_len {
        o.resize(out_len, 0);
    }
    s.as_mut_ptr()
}

#[no_mangle]
pub extern "C" fn out_addr() -> *mut u8 {
    out_buf().as_mut_ptr()
}

struct LenCoder {
    choice: [u16; 2],
    low: [[u16; 8]; 16],
    mid: [[u16; 8]; 16],
    high: [u16; 256],
}

impl LenCoder {
    fn new() -> Self {
        LenCoder {
            choice: [1024; 2],
            low: [[1024; 8]; 16],
            mid: [[1024; 8]; 16],
            high: [1024; 256],
        }
    }
}

struct Rc<'a> {
    src: &'a [u8],
    pos: usize,
    range: u32,
    code: u32,
}

impl<'a> Rc<'a> {
    fn byte(&mut self) -> u32 {
        let b = if self.pos < self.src.len() { self.src[self.pos] } else { 0 };
        self.pos += 1;
        b as u32
    }

    fn normalize(&mut self) {
        if self.range < 0x0100_0000 {
            self.range = self.range << 8;
            let b = self.byte();
            self.code = (self.code << 8) | b;
        }
    }

    fn bit(&mut self, probs: &mut [u16], idx: usize) -> u32 {
        let p = probs[idx] as u32;
        let bound = (self.range >> 11) * p;
        let bit;
        if self.code < bound {
            self.range = bound;
            probs[idx] = (p + ((2048 - p) >> 5)) as u16;
            bit = 0;
        } else {
            self.code = self.code.wrapping_sub(bound);
            self.range = self.range.wrapping_sub(bound);
            probs[idx] = (p - (p >> 5)) as u16;
            bit = 1;
        }
        self.normalize();
        bit
    }

    fn tree(&mut self, probs: &mut [u16], bits: u32) -> u32 {
        let mut m: u32 = 1;
        for _ in 0..bits {
            let b = self.bit(probs, m as usize);
            m = (m << 1) | b;
        }
        m - (1 << bits)
    }

    fn rev_tree(&mut self, probs: &mut [u16], bits: u32, base: usize) -> u32 {
        let mut m: u32 = 1;
        let mut sym: u32 = 0;
        for i in 0..bits {
            let b = self.bit(probs, base + m as usize);
            m = (m << 1) | b;
            sym |= b << i;
        }
        sym
    }

    fn direct(&mut self, bits: u32) -> u32 {
        let mut res: u32 = 0;
        for _ in 0..bits {
            self.range >>= 1;
            self.code = self.code.wrapping_sub(self.range);
            let t = 0u32.wrapping_sub(self.code >> 31);
            self.code = self.code.wrapping_add(self.range & t);
            res = (res << 1).wrapping_add(t.wrapping_add(1));
            self.normalize();
        }
        res
    }

    fn len(&mut self, c: &mut LenCoder, pos_state: usize) -> u32 {
        if self.bit(&mut c.choice, 0) == 0 {
            return self.tree(&mut c.low[pos_state], 3);
        }
        if self.bit(&mut c.choice, 1) == 0 {
            return 8 + self.tree(&mut c.mid[pos_state], 3);
        }
        16 + self.tree(&mut c.high, 8)
    }
}

#[no_mangle]
pub extern "C" fn decode(src_len: usize, out_size: usize, props0: u32) -> i32 {
    if props0 >= 9 * 5 * 5 || src_len < 5 {
        return 0;
    }
    if src_buf().len() < src_len || out_buf().len() < out_size {
        return 0;
    }
    let lc = props0 % 9;
    let d = props0 / 9;
    let lp = d % 5;
    let pb = d / 5;

    let src_all: &[u8] = unsafe { std::slice::from_raw_parts(src_buf().as_ptr(), src_len) };
    let out: &mut [u8] = &mut out_buf()[..out_size];
    for v in out.iter_mut() {
        *v = 0;
    }

    let mut rc = Rc { src: src_all, pos: 1, range: 0xFFFF_FFFF, code: 0 };
    for _ in 0..4 {
        let b = rc.byte();
        rc.code = (rc.code << 8) | b;
    }

    const K_STATES: usize = 12;
    let mut probs_lit = vec![1024u16; 0x300usize << (lc + lp)];
    let mut is_match = [1024u16; K_STATES << 4];
    let mut is_rep = [1024u16; K_STATES];
    let mut is_rep_g0 = [1024u16; K_STATES];
    let mut is_rep_g1 = [1024u16; K_STATES];
    let mut is_rep_g2 = [1024u16; K_STATES];
    let mut is_rep0_long = [1024u16; K_STATES << 4];
    let mut pos_slot = [[1024u16; 64]; 4];
    let mut spec_pos = [1024u16; 115];
    let mut align = [1024u16; 16];
    let mut len_coder = LenCoder::new();
    let mut rep_len_coder = LenCoder::new();

    let mut state: usize = 0;
    let (mut rep0, mut rep1, mut rep2, mut rep3): (u32, u32, u32, u32) = (0, 0, 0, 0);
    let pb_mask = (1usize << pb) - 1;
    let lp_mask = (1usize << lp) - 1;
    let mut out_pos: usize = 0;

    while out_pos < out_size {
        let pos_state = out_pos & pb_mask;
        if rc.bit(&mut is_match, (state << 4) + pos_state) == 0 {
            let prev = if out_pos > 0 { out[out_pos - 1] as u32 } else { 0 };
            let lit_state = ((out_pos & lp_mask) << lc) + (prev >> (8 - lc)) as usize;
            let base = 0x300 * lit_state;
            let mut symbol: u32 = 1;
            if state < 7 {
                while symbol < 0x100 {
                    let b = rc.bit(&mut probs_lit, base + symbol as usize);
                    symbol = (symbol << 1) | b;
                }
            } else {
                let mi = out_pos.wrapping_sub(rep0 as usize).wrapping_sub(1);
                let mut match_byte = if mi < out_size { out[mi] as u32 } else { 0 };
                while symbol < 0x100 {
                    let match_bit = (match_byte >> 7) & 1;
                    match_byte = (match_byte << 1) & 0xFF;
                    let bit = rc.bit(&mut probs_lit, base + (((1 + match_bit) as usize) << 8) + symbol as usize);
                    symbol = (symbol << 1) | bit;
                    if match_bit != bit {
                        while symbol < 0x100 {
                            let b = rc.bit(&mut probs_lit, base + symbol as usize);
                            symbol = (symbol << 1) | b;
                        }
                        break;
                    }
                }
            }
            out[out_pos] = (symbol & 0xFF) as u8;
            out_pos += 1;
            state = if state < 4 { 0 } else if state < 10 { state - 3 } else { state - 6 };
            continue;
        }

        let mut len;
        if rc.bit(&mut is_rep, state) != 0 {
            if rc.bit(&mut is_rep_g0, state) == 0 {
                if rc.bit(&mut is_rep0_long, (state << 4) + pos_state) == 0 {
                    state = if state < 7 { 9 } else { 11 };
                    let from = out_pos.wrapping_sub(rep0 as usize).wrapping_sub(1);
                    if from >= out_size {
                        return 0;
                    }
                    out[out_pos] = out[from];
                    out_pos += 1;
                    continue;
                }
            } else {
                let dist;
                if rc.bit(&mut is_rep_g1, state) == 0 {
                    dist = rep1;
                } else {
                    if rc.bit(&mut is_rep_g2, state) == 0 {
                        dist = rep2;
                    } else {
                        dist = rep3;
                        rep3 = rep2;
                    }
                    rep2 = rep1;
                }
                rep1 = rep0;
                rep0 = dist;
            }
            len = 2 + rc.len(&mut rep_len_coder, pos_state);
            state = if state < 7 { 8 } else { 11 };
        } else {
            rep3 = rep2;
            rep2 = rep1;
            rep1 = rep0;
            len = 2 + rc.len(&mut len_coder, pos_state);
            state = if state < 7 { 7 } else { 10 };
            let len_to_pos = if len < 6 { (len - 2) as usize } else { 3 };
            let slot = rc.tree(&mut pos_slot[len_to_pos], 6);
            if slot < 4 {
                rep0 = slot;
            } else {
                let num_direct = (slot >> 1) - 1;
                rep0 = (2 | (slot & 1)) << num_direct;
                if slot < 14 {
                    let base = (rep0 as usize).wrapping_sub(slot as usize).wrapping_sub(1);
                    rep0 = rep0.wrapping_add(rc.rev_tree(&mut spec_pos, num_direct, base));
                } else {
                    rep0 = rep0.wrapping_add(rc.direct(num_direct - 4) << 4);
                    rep0 = rep0.wrapping_add(rc.rev_tree(&mut align, 4, 0));
                    if rep0 == 0xFFFF_FFFF {
                        break;
                    }
                }
            }
        }

        if rep0 as usize >= out_pos || len as usize > out_size - out_pos {
            if rep0 as usize >= out_pos {
                return 0;
            }
            len = (out_size - out_pos) as u32;
        }
        let from = out_pos - rep0 as usize - 1;
        for i in 0..len as usize {
            out[out_pos + i] = out[from + i];
        }
        out_pos += len as usize;
    }

    1
}
