package android.database;
/** Stand-in: one row, kept as given (CameraPhotoProvider adds exactly one). */
public final class MatrixCursor implements Cursor {
    private final String[] columns;
    private Object[] row;
    public MatrixCursor(String[] columns, int capacity) { this.columns = columns.clone(); }
    public void addRow(Object[] values) { if (row != null) throw new IllegalStateException("one row only"); if (values.length != columns.length) throw new IllegalArgumentException("columns"); row = values.clone(); }
    @Override public String[] getColumnNames() { return columns.clone(); }
    @Override public Object[] row() { return row == null ? null : row.clone(); }
}
