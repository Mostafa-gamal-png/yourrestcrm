package org.json;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.Map;
/** Stand-in for Android's org.json.JSONObject: a strict parser and writer, and the methods the app reads and writes with. JSON null is
 *  JSONObject.NULL, an integer is an Integer or a Long, a number with a fraction or an exponent a Double, as Android gives them. */
public class JSONObject {
    public static final Object NULL = new Object() { @Override public String toString() { return "null"; } };
    final Map<String, Object> values = new LinkedHashMap<>();
    public JSONObject() { }
    public JSONObject(Map<?, ?> copy) { for (Map.Entry<?, ?> entry : copy.entrySet()) if (entry.getValue() != null) values.put(String.valueOf(entry.getKey()), entry.getValue()); }
    public JSONObject(String text) throws JSONException { Object value = parse(text); if (!(value instanceof JSONObject)) throw new JSONException("Not an object"); values.putAll(((JSONObject) value).values); }
    public JSONObject put(String name, Object value) throws JSONException { if (name == null) throw new JSONException("Null name"); if (value == null) values.remove(name); else values.put(name, value); return this; }
    public JSONObject put(String name, long value) throws JSONException { return put(name, (Object) value); }
    public JSONObject put(String name, int value) throws JSONException { return put(name, (Object) value); }
    public JSONObject put(String name, double value) throws JSONException { return put(name, (Object) value); }
    public JSONObject put(String name, boolean value) throws JSONException { return put(name, (Object) value); }
    public Object opt(String name) { return values.get(name); }
    public boolean has(String name) { return values.containsKey(name); }
    public boolean isNull(String name) { Object value = values.get(name); return value == null || value == NULL; }
    public Object get(String name) throws JSONException { Object value = values.get(name); if (value == null) throw new JSONException("No value for " + name); return value; }
    public String getString(String name) throws JSONException { Object value = get(name); if (value instanceof String) return (String) value; if (value == NULL) throw new JSONException("Null " + name); return String.valueOf(value); }
    public int getInt(String name) throws JSONException { Object value = get(name); if (value instanceof Number) return ((Number) value).intValue(); try { return (int) Double.parseDouble(String.valueOf(value)); } catch (NumberFormatException e) { throw new JSONException("Not a number: " + name); } }
    public long getLong(String name) throws JSONException { Object value = get(name); if (value instanceof Number) return ((Number) value).longValue(); throw new JSONException("Not a number: " + name); }
    public JSONArray getJSONArray(String name) throws JSONException { Object value = get(name); if (value instanceof JSONArray) return (JSONArray) value; throw new JSONException("Not an array: " + name); }
    public JSONObject getJSONObject(String name) throws JSONException { Object value = get(name); if (value instanceof JSONObject) return (JSONObject) value; throw new JSONException("Not an object: " + name); }
    public JSONObject optJSONObject(String name) { Object value = values.get(name); return value instanceof JSONObject ? (JSONObject) value : null; }
    public JSONArray optJSONArray(String name) { Object value = values.get(name); return value instanceof JSONArray ? (JSONArray) value : null; }
    public String optString(String name) { return optString(name, ""); }
    public String optString(String name, String fallback) { Object value = values.get(name); return value == null ? fallback : String.valueOf(value); }
    public long optLong(String name, long fallback) { Object value = values.get(name); return value instanceof Number ? ((Number) value).longValue() : fallback; }
    public Iterator<String> keys() { return values.keySet().iterator(); }
    public int length() { return values.size(); }
    @Override public String toString() { StringBuilder out = new StringBuilder(); write(out, this); return out.toString(); }

    static void write(StringBuilder out, Object value) {
        if (value == null || value == NULL) { out.append("null"); return; }
        if (value instanceof JSONObject) { out.append('{'); boolean first = true; for (Map.Entry<String, Object> entry : ((JSONObject) value).values.entrySet()) { if (!first) out.append(','); first = false; quote(out, entry.getKey()); out.append(':'); write(out, entry.getValue()); } out.append('}'); return; }
        if (value instanceof JSONArray) { out.append(value.toString()); return; }
        if (value instanceof Map) { write(out, new JSONObject((Map<?, ?>) value)); return; }
        if (value instanceof Number || value instanceof Boolean) { out.append(value); return; }
        quote(out, String.valueOf(value));
    }
    static void quote(StringBuilder out, String text) {
        out.append('"');
        for (char c : text.toCharArray()) {
            if (c == '"' || c == '\\') out.append('\\').append(c);
            else if (c == '\n') out.append("\\n"); else if (c == '\r') out.append("\\r"); else if (c == '\t') out.append("\\t");
            else if (c < 0x20) out.append(String.format("\\u%04x", (int) c)); else out.append(c);
        }
        out.append('"');
    }
    static Object parse(String text) throws JSONException {
        if (text == null) throw new JSONException("Null text");
        int[] at = {0};
        Object value = value(text, at);
        skip(text, at);
        if (at[0] != text.length()) throw new JSONException("Trailing text");
        return value;
    }
    private static void skip(String text, int[] at) { while (at[0] < text.length() && Character.isWhitespace(text.charAt(at[0]))) at[0]++; }
    private static Object value(String text, int[] at) throws JSONException {
        skip(text, at);
        if (at[0] >= text.length()) throw new JSONException("End of text");
        char c = text.charAt(at[0]);
        if (c == '{') {
            JSONObject object = new JSONObject(); at[0]++; skip(text, at);
            if (at[0] < text.length() && text.charAt(at[0]) == '}') { at[0]++; return object; }
            while (true) {
                skip(text, at); if (at[0] >= text.length() || text.charAt(at[0]) != '"') throw new JSONException("Expected a name");
                String name = string(text, at); skip(text, at);
                if (at[0] >= text.length() || text.charAt(at[0]++) != ':') throw new JSONException("Expected :");
                object.values.put(name, value(text, at)); skip(text, at);
                if (at[0] >= text.length()) throw new JSONException("Unclosed object");
                char next = text.charAt(at[0]++);
                if (next == '}') return object;
                if (next != ',') throw new JSONException("Expected , or }");
            }
        }
        if (c == '[') {
            JSONArray array = new JSONArray(); at[0]++; skip(text, at);
            if (at[0] < text.length() && text.charAt(at[0]) == ']') { at[0]++; return array; }
            while (true) {
                array.values.add(value(text, at)); skip(text, at);
                if (at[0] >= text.length()) throw new JSONException("Unclosed array");
                char next = text.charAt(at[0]++);
                if (next == ']') return array;
                if (next != ',') throw new JSONException("Expected , or ]");
            }
        }
        if (c == '"') return string(text, at);
        if (text.startsWith("true", at[0])) { at[0] += 4; return Boolean.TRUE; }
        if (text.startsWith("false", at[0])) { at[0] += 5; return Boolean.FALSE; }
        if (text.startsWith("null", at[0])) { at[0] += 4; return NULL; }
        int start = at[0];
        while (at[0] < text.length() && "+-0123456789.eE".indexOf(text.charAt(at[0])) >= 0) at[0]++;
        String number = text.substring(start, at[0]);
        if (number.isEmpty()) throw new JSONException("Unexpected " + c);
        try {
            if (number.matches("-?\\d+")) { long whole = Long.parseLong(number); return whole >= Integer.MIN_VALUE && whole <= Integer.MAX_VALUE ? (Object) (int) whole : (Object) whole; }
            return Double.parseDouble(number);
        } catch (NumberFormatException e) { throw new JSONException("Bad number " + number); }
    }
    private static String string(String text, int[] at) throws JSONException {
        StringBuilder out = new StringBuilder(); at[0]++;
        while (at[0] < text.length()) {
            char c = text.charAt(at[0]++);
            if (c == '"') return out.toString();
            if (c != '\\') { out.append(c); continue; }
            if (at[0] >= text.length()) break;
            char e = text.charAt(at[0]++);
            switch (e) {
                case 'n': out.append('\n'); break; case 't': out.append('\t'); break; case 'r': out.append('\r'); break;
                case 'b': out.append('\b'); break; case 'f': out.append('\f'); break;
                case 'u': if (at[0] + 4 > text.length()) throw new JSONException("Bad escape"); out.append((char) Integer.parseInt(text.substring(at[0], at[0] + 4), 16)); at[0] += 4; break;
                default: out.append(e);
            }
        }
        throw new JSONException("Unclosed string");
    }
}
