package org.json;
import java.util.ArrayList;
import java.util.List;
/** Stand-in for Android's org.json.JSONArray: the methods the app reads with. */
public class JSONArray {
    final List<Object> values = new ArrayList<>();
    public JSONArray() { }
    public JSONArray(String text) throws JSONException { Object value = JSONObject.parse(text); if (!(value instanceof JSONArray)) throw new JSONException("Not an array"); values.addAll(((JSONArray) value).values); }
    public int length() { return values.size(); }
    public Object opt(int index) { return index >= 0 && index < values.size() ? values.get(index) : null; }
    public Object get(int index) throws JSONException { Object value = opt(index); if (value == null) throw new JSONException("No value at " + index); return value; }
    public JSONObject getJSONObject(int index) throws JSONException { Object value = get(index); if (!(value instanceof JSONObject)) throw new JSONException("Not an object at " + index); return (JSONObject) value; }
    public JSONObject optJSONObject(int index) { Object value = opt(index); return value instanceof JSONObject ? (JSONObject) value : null; }
    public JSONArray put(Object value) { values.add(value == null ? JSONObject.NULL : value); return this; }
    @Override public String toString() { StringBuilder out = new StringBuilder("["); for (int i = 0; i < values.size(); i++) { if (i > 0) out.append(','); JSONObject.write(out, values.get(i)); } return out.append(']').toString(); }
}
