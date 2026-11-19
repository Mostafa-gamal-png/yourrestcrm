package android.database;
/** Stand-in: what the check reads back of a cursor. */
public interface Cursor {
    String[] getColumnNames();
    Object[] row();
}
