function exportRecordsToCSV(records) {
  const headers = ['日期', '线路', '车牌', '物流蓝出', '物流红出', '蓝发出', '蓝收回', '红发出', '红收回', '备注', '创建时间']
  const rows = records.map(r => [
    r.date || '',
    r.routeName || '',
    r.plateNumber || '',
    r.sendBlueOut || 0,
    r.sendRedOut || 0,
    r.blueOut || 0,
    r.blueIn || 0,
    r.redOut || 0,
    r.redIn || 0,
    r.remark || '',
    r.createTime || ''
  ])

  const csvContent = [headers, ...rows]
    .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\n')

  return `\uFEFF${csvContent}`
}

function escapeExcelXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function encodeUtf8(str) {
  const bytes = []
  for (let i = 0; i < str.length; i++) {
    let code = str.charCodeAt(i)
    if (code >= 0xD800 && code <= 0xDBFF && i + 1 < str.length) {
      const next = str.charCodeAt(i + 1)
      if (next >= 0xDC00 && next <= 0xDFFF) {
        code = 0x10000 + ((code - 0xD800) << 10) + (next - 0xDC00)
        i++
      }
    }

    if (code < 0x80) {
      bytes.push(code)
    } else if (code < 0x800) {
      bytes.push(0xC0 | (code >> 6), 0x80 | (code & 0x3F))
    } else if (code < 0x10000) {
      bytes.push(0xE0 | (code >> 12), 0x80 | ((code >> 6) & 0x3F), 0x80 | (code & 0x3F))
    } else {
      bytes.push(0xF0 | (code >> 18), 0x80 | ((code >> 12) & 0x3F), 0x80 | ((code >> 6) & 0x3F), 0x80 | (code & 0x3F))
    }
  }
  return new Uint8Array(bytes)
}

function getCrc32(bytes) {
  let crc = 0xFFFFFFFF
  for (let i = 0; i < bytes.length; i++) {
    crc ^= bytes[i]
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0)
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0
}

function writeUint16(bytes, value) {
  bytes.push(value & 0xFF, (value >>> 8) & 0xFF)
}

function writeUint32(bytes, value) {
  bytes.push(value & 0xFF, (value >>> 8) & 0xFF, (value >>> 16) & 0xFF, (value >>> 24) & 0xFF)
}

function createZip(files) {
  const output = []
  const centralDirectory = []
  let offset = 0

  files.forEach(file => {
    const nameBytes = encodeUtf8(file.name)
    const dataBytes = encodeUtf8(file.content)
    const crc32 = getCrc32(dataBytes)

    writeUint32(output, 0x04034B50)
    writeUint16(output, 20)
    writeUint16(output, 0x0800)
    writeUint16(output, 0)
    writeUint16(output, 0)
    writeUint16(output, 0)
    writeUint32(output, crc32)
    writeUint32(output, dataBytes.length)
    writeUint32(output, dataBytes.length)
    writeUint16(output, nameBytes.length)
    writeUint16(output, 0)
    output.push(...nameBytes, ...dataBytes)

    writeUint32(centralDirectory, 0x02014B50)
    writeUint16(centralDirectory, 20)
    writeUint16(centralDirectory, 20)
    writeUint16(centralDirectory, 0x0800)
    writeUint16(centralDirectory, 0)
    writeUint16(centralDirectory, 0)
    writeUint16(centralDirectory, 0)
    writeUint32(centralDirectory, crc32)
    writeUint32(centralDirectory, dataBytes.length)
    writeUint32(centralDirectory, dataBytes.length)
    writeUint16(centralDirectory, nameBytes.length)
    writeUint16(centralDirectory, 0)
    writeUint16(centralDirectory, 0)
    writeUint16(centralDirectory, 0)
    writeUint16(centralDirectory, 0)
    writeUint32(centralDirectory, 0)
    writeUint32(centralDirectory, offset)
    centralDirectory.push(...nameBytes)

    offset = output.length
  })

  const centralDirectoryOffset = output.length
  output.push(...centralDirectory)

  writeUint32(output, 0x06054B50)
  writeUint16(output, 0)
  writeUint16(output, 0)
  writeUint16(output, files.length)
  writeUint16(output, files.length)
  writeUint32(output, centralDirectory.length)
  writeUint32(output, centralDirectoryOffset)
  writeUint16(output, 0)

  return new Uint8Array(output).buffer
}

function toExcelColumn(index) {
  let column = ''
  let n = index + 1
  while (n > 0) {
    const remainder = (n - 1) % 26
    column = String.fromCharCode(65 + remainder) + column
    n = Math.floor((n - 1) / 26)
  }
  return column
}

function exportRecordsToExcel(records) {
  const headers = ['日期', '线路', '车牌', '物流蓝出', '物流红出', '蓝发出', '蓝收回', '红发出', '红收回', '备注', '创建时间']
  const rows = records.map(r => [
    r.date || '',
    r.routeName || '',
    r.plateNumber || '',
    r.sendBlueOut || 0,
    r.sendRedOut || 0,
    r.blueOut || 0,
    r.blueIn || 0,
    r.redOut || 0,
    r.redIn || 0,
    r.remark || '',
    r.createTime || ''
  ])

  const buildCell = (cell, rowIndex, columnIndex) => {
    const ref = `${toExcelColumn(columnIndex)}${rowIndex}`
    if (typeof cell === 'number') {
      return `<c r="${ref}"><v>${cell}</v></c>`
    }
    return `<c r="${ref}" t="inlineStr"><is><t>${escapeExcelXml(cell)}</t></is></c>`
  }

  const sheetRows = [headers, ...rows].map((row, rowIndex) => {
    const excelRowIndex = rowIndex + 1
    return `<row r="${excelRowIndex}">${row.map((cell, columnIndex) => buildCell(cell, excelRowIndex, columnIndex)).join('')}</row>`
  }).join('')

  const files = [
    {
      name: '[Content_Types].xml',
      content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>'
    },
    {
      name: '_rels/.rels',
      content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'
    },
    {
      name: 'xl/workbook.xml',
      content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="历史记录" sheetId="1" r:id="rId1"/></sheets></workbook>'
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'
    },
    {
      name: 'xl/styles.xml',
      content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><name val="Arial"/></font></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="1"><xf numFmtId="0" fontId="0" borderId="0" fillId="0" xfId="0"/></cellXfs></styleSheet>'
    },
    {
      name: 'xl/worksheets/sheet1.xml',
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData></worksheet>`
    }
  ]

  return createZip(files)
}

module.exports = {
  exportRecordsToCSV,
  exportRecordsToExcel
}
