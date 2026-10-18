#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-only
# Build site/app/data/redaction-sample.pdf: a fictional memo for practising with the redaction inspector.
#   python3 tools/make-redaction-sample.py            # from the repository root
# It shows the three cases the inspector reports: a box drawn over text that is still in the file (unsafe),
# a box with the text really removed (safe), and a Redact annotation that was marked but never applied.
# A second, incremental save changes the title, so the file also holds an earlier version.
import sys
OUT = (sys.argv[1] if len(sys.argv) > 1 else '.') + '/site/app/data/redaction-sample.pdf'

def text(x, y, s, size=11, font='F1'):
    s = s.replace('\\', '\\\\').replace('(', '\\(').replace(')', '\\)')
    return f'BT /{font} {size} Tf {x} {y} Td ({s}) Tj ET\n'

c = '0 0 0 rg\n'
c += text(72, 760, 'TRAINING SAMPLE - FICTIONAL DOCUMENT', 9, 'F2')
c += text(72, 730, 'MEMORANDUM FOR THE RECORD', 16, 'F2')
c += text(72, 704, 'Subject: Visit to the harbour observatory, 14 March 1979')
c += text(72, 670, 'This memo is invented for teaching. No real person, place or event is described.', 10)
c += text(72, 640, 'The visiting scientist was')
c += text(214, 640, 'Dr. Imaginary Placeholder')             # covered by a box below: still in the file
c += text(72, 620, 'The meeting took place at')
# (nothing is written where the second box goes: that text was really removed)
c += text(72, 600, 'Funding came from')
c += text(172, 600, 'the Example Foundation')                  # marked with a Redact annotation, never applied
c += text(72, 570, 'Lesson: a black box drawn on top hides words from the eye, not from the file.')
c += text(72, 552, 'Open this file in the inspector to see which redactions are real.')
c += '0 0 0 rg 210 636 146 15 re f\n'   # unsafe box over the name
c += '0 0 0 rg 214 616 120 15 re f\n'   # safe box, nothing underneath

objs = {
    1: '<< /Type /Catalog /Pages 2 0 R >>',
    2: '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    3: '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R /Annots [8 0 R] >>',
    4: f'<< /Length {len(c)} >>\nstream\n{c}endstream',
    5: '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    6: '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>',
    7: '<< /Title (Harbour observatory visit - draft) /Author (Training Office) /Creator (Global Intelligence Atlas sample builder) /Producer (hand-written PDF) /CreationDate (D:19790314090000Z) >>',
    8: '<< /Type /Annot /Subtype /Redact /Rect [170 596 290 612] /Contents (Funding source) /IC [0 0 0] /OverlayText (WITHHELD) >>',
}
out = b'%PDF-1.4\n%\xe2\xe3\xcf\xd3\n'; off = {}
for i in sorted(objs):
    off[i] = len(out); out += f'{i} 0 obj\n{objs[i]}\nendobj\n'.encode('latin-1')
xref = len(out)
out += f'xref\n0 {len(objs) + 1}\n0000000000 65535 f \n'.encode() + b''.join(f'{off[i]:010d} 00000 n \n'.encode() for i in sorted(objs))
out += f'trailer\n<< /Size {len(objs) + 1} /Root 1 0 R /Info 7 0 R >>\nstartxref\n{xref}\n%%EOF\n'.encode()
# incremental update: a new Info object; the old one (with the draft title) stays in the file
o9 = len(out)
out += b'9 0 obj\n<< /Title (Harbour observatory visit - released) /Author (Training Office) /Producer (hand-written PDF) /ModDate (D:20260101120000Z) >>\nendobj\n'
x2 = len(out)
out += f'xref\n0 1\n0000000000 65535 f \n9 1\n{o9:010d} 00000 n \ntrailer\n<< /Size 10 /Root 1 0 R /Info 9 0 R /Prev {xref} >>\nstartxref\n{x2}\n%%EOF\n'.encode()
open(OUT, 'wb').write(out)
print(OUT, len(out), 'bytes')
