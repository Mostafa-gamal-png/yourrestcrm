-- What each file the CRM attaches to a mold request is (yourrest-products 2026-11-03, the quotation and PO numbers and their files,
-- docs/MOLD-REQUESTS-CONTRACT-AR.md): a design file (every file attached before this migration), the quotation's or the PO's. The
-- category is sent with design-files for a quotation or PO file only, so a design file goes exactly as before. No other change.
ALTER TABLE crm_mold_design_files ADD COLUMN category TEXT NOT NULL DEFAULT 'design' CHECK(category IN ('design','quote','po'));
