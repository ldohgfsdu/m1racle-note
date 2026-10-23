// CM6 positions count LF-normalized UTF-16 code units. Keep untouched bytes
// represented by the original string, and map only explicit transaction ranges.
export class SourceDocument {
  #raw;
  #crlf = null;
  constructor(raw) { this.raw = raw; this.eol = raw.match(/\r\n|\r|\n/)?.[0] ?? '\n'; }
  get raw() { return this.#raw; }
  set raw(value) { this.#raw = value; this.#crlf = null; }
  normalized() { return this.raw.replace(/\r\n|\r/g, '\n'); }
  offset(position) {
    // Only CRLF changes the length of CM6's UTF-16 coordinate space.
    // Index those boundaries once, rather than rescanning every character for
    // each endpoint of every change (e.g. a long selection or Replace All).
    if (this.#crlf === null) {
      this.#crlf = [];
      for (let at = this.raw.indexOf('\r\n'); at !== -1; at = this.raw.indexOf('\r\n', at + 2)) {
        this.#crlf.push(at - this.#crlf.length);
      }
    }
    if (!Number.isInteger(position) || position < 0 || position > this.raw.length - this.#crlf.length) throw new RangeError('Invalid source position');
    let from = 0, to = this.#crlf.length;
    while (from < to) {
      const middle = (from + to) >>> 1;
      if (this.#crlf[middle] < position) from = middle + 1;
      else to = middle;
    }
    return position + from;
  }
  apply(changes, {preserveEndings = false} = {}) {
    const mapped = changes.map(({ from, to, insert }) => ({
      from: this.offset(from), to: this.offset(to),
      insert: preserveEndings ? insert : insert.replace(/\r\n|\r|\n/g, this.eol),
    }));
    const merged=[];
    for(const change of mapped) {
      const previous=merged.at(-1);
      if(previous && previous.to===change.from){previous.to=change.to;previous.insert+=change.insert;}
      else merged.push({...change});
    }
    for (const change of merged.reverse()) {
      const prefix=this.raw.slice(0,change.from),suffix=this.raw.slice(change.to);let insert=change.insert;
      // Joining untouched CR and LF bytes must not collapse two CM6 newlines
      // into one. Padding belongs to this replacement's source range.
      if(!insert && prefix.endsWith('\r') && suffix.startsWith('\n'))insert='\r';
      else {
        if(prefix.endsWith('\r') && insert.startsWith('\n'))insert='\r'+insert;
        if(insert.endsWith('\r') && suffix.startsWith('\n'))insert+='\n';
      }
      this.raw = prefix + insert + suffix;
    }
    return this.raw;
  }
}
