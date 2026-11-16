package android.net;
public final class Uri { public final String text; private Uri(String text) { this.text = text; } public static Uri parse(String text) { return new Uri(text); } @Override public String toString() { return text; } }
