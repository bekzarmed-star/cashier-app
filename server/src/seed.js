import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';
import { pool, query } from './db.js';
import { ensureAdminSeed, ADMIN_DEFAULT_PASSWORD } from './adminAuth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function seed() {
  const schemaPath = path.join(__dirname, '../sql/schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf8');
  await query(schema);
  console.log('✓ Schema applied');

  const adminInfo = await ensureAdminSeed();
  console.log(`✓ Admin user ready (username: admin)`);
  console.log(`✓ Admin E-imzo key: ${adminInfo.keyPath}`);
  console.log(`  Default password (change after login): ${ADMIN_DEFAULT_PASSWORD}`);

  const codesPath = path.join(__dirname, '../../src/data/accountCodes.json');
  const codes = JSON.parse(fs.readFileSync(codesPath, 'utf8'));

  for (const c of codes) {
    await query(
      `INSERT INTO account_codes (code, english, russian, uzbek, note, archived, grp)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (code) DO UPDATE SET
         english = EXCLUDED.english,
         russian = EXCLUDED.russian,
         uzbek = EXCLUDED.uzbek,
         note = EXCLUDED.note,
         archived = EXCLUDED.archived,
         grp = EXCLUDED.grp`,
      [c.code, c.english || '', c.russian || '', c.uzbek || '', c.note || '', !!c.archived, c.group || 'Расход'],
    );
  }
  console.log(`✓ Seeded ${codes.length} account codes`);

  const hash = await bcrypt.hash('1234', 10);
  await query(
    `INSERT INTO cashiers (id, username, password_hash, name, role, counter_id)
     VALUES ('u1', 'cashier', $1, 'Dilnoza Karimova', 'cashier', 'C-01'),
            ('u2', 'supervisor', $1, 'Jasur Abdullayev', 'supervisor', 'C-01')
     ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash`,
    [hash],
  );
  console.log('✓ Seeded cashiers (cashier/1234, supervisor/1234)');

  const patients = [
    ['p1', 'MRN-240815', 'Aziza Rahimova', '+998 90 111 22 33', 34, 'F', 'Outpatient'],
    ['p2', 'MRN-240902', 'Bobur Toshmatov', '+998 93 444 55 66', 52, 'M', 'Cardiology'],
    ['p3', 'MRN-241010', 'Malika Yusupova', '+998 97 777 88 99', 28, 'F', 'Laboratory'],
    ['p4', 'MRN-241118', 'Sardor Nazarov', '+998 91 222 33 44', 41, 'M', 'Radiology'],
    ['p5', 'MRN-241205', 'Nilufar Qodirova', '+998 94 555 66 77', 19, 'F', 'Emergency'],
  ];
  for (const p of patients) {
    await query(
      `INSERT INTO patients (id, mrn, name, phone, age, gender, department)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (id) DO NOTHING`,
      p,
    );
  }
  console.log('✓ Seeded patients');

  const { rows: existingBills } = await query('SELECT COUNT(*)::int AS n FROM bills');
  if (existingBills[0].n === 0) {
    const bills = [
      {
        id: 'b1',
        invoice: 'INV-2026-0842',
        patient: 'p1',
        items: [
          ['i1', 'CONS-GP', 'General consultation', 'consultation', 1, 150000, 0],
          ['i2', 'LAB-CBC', 'Complete blood count', 'laboratory', 1, 85000, 0],
          ['i3', 'LAB-GLU', 'Blood glucose', 'laboratory', 1, 45000, 5000],
        ],
      },
      {
        id: 'b2',
        invoice: 'INV-2026-0843',
        patient: 'p2',
        items: [
          ['i4', 'CONS-CARD', 'Cardiology consultation', 'consultation', 1, 250000, 0],
          ['i5', 'RAD-ECG', 'ECG', 'radiology', 1, 120000, 0],
          ['i6', 'RAD-ECHO', 'Echocardiography', 'radiology', 1, 450000, 50000],
        ],
      },
      {
        id: 'b3',
        invoice: 'INV-2026-0844',
        patient: 'p3',
        items: [
          ['i7', 'LAB-PANEL', 'Biochemistry panel', 'laboratory', 1, 320000, 0],
          ['i8', 'LAB-URINE', 'Urinalysis', 'laboratory', 1, 55000, 0],
        ],
      },
      {
        id: 'b4',
        invoice: 'INV-2026-0845',
        patient: 'p4',
        paid: 200000,
        status: 'partial',
        items: [
          ['i9', 'RAD-XRAY', 'Chest X-ray', 'radiology', 1, 180000, 0],
          ['i10', 'RAD-CT', 'CT abdomen', 'radiology', 1, 780000, 0],
        ],
      },
      {
        id: 'b5',
        invoice: 'INV-2026-0846',
        patient: 'p5',
        items: [
          ['i11', 'ER-TRIAGE', 'Emergency triage', 'procedure', 1, 200000, 0],
          ['i12', 'PHARM-001', 'IV fluids & meds', 'pharmacy', 1, 165000, 15000],
        ],
      },
    ];

    for (const b of bills) {
      await query(
        `INSERT INTO bills (id, invoice_no, patient_id, status, paid_amount)
         VALUES ($1,$2,$3,$4,$5)`,
        [b.id, b.invoice, b.patient, b.status || 'pending', b.paid || 0],
      );
      for (const it of b.items) {
        await query(
          `INSERT INTO bill_items (id, bill_id, code, name, category, qty, unit_price, discount)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [it[0], b.id, it[1], it[2], it[3], it[4], it[5], it[6]],
        );
      }
    }
    console.log('✓ Seeded sample bills');
  } else {
    console.log('· Bills already present — skipped');
  }

  const { rows: drawers } = await query(
    `SELECT id FROM cash_drawers WHERE status = 'open' LIMIT 1`,
  );
  if (drawers.length === 0) {
    await query(
      `INSERT INTO cash_drawers (id, counter_id, cashier_id, cashier_name, opening_float, status)
       VALUES ('d1', 'C-01', 'u1', 'Dilnoza Karimova', 500000, 'open')`,
    );
    console.log('✓ Opened default cash drawer');
  }

  console.log('\nDatabase ready: cashier @ PostgreSQL');
  await pool.end();
}

seed().catch(async (err) => {
  console.error('Seed failed:', err.message);
  await pool.end();
  process.exit(1);
});
