package com.m1racle.note

import org.json.JSONObject

data class NativeNote(val id:String,val title:String,val preview:String,val modified:Long)
data class ChromeState(val screen:String="home",val notes:List<NativeNote> = emptyList(),val dark:Boolean=false,
    val paper:String="fluid",val font:String="sans",val size:Float=17f,val leading:Float=1.8f,val theme:String="system",
    val busy:Boolean=false,val error:String="") {
    companion object {
        fun parse(event:JSONObject):ChromeState {
            val prefs=event.optJSONObject("preferences")?:JSONObject()
            val array=event.optJSONArray("notes")
            val notes=if(array==null) emptyList() else (0 until array.length()).map { i->val n=array.getJSONObject(i);NativeNote(n.getString("id"),n.getString("title"),n.getString("preview"),n.getLong("modified")) }
            return ChromeState(event.optString("screen","home"),notes,event.optBoolean("dark"),prefs.optString("paper","fluid"),prefs.optString("font","sans"),prefs.optDouble("size",17.0).toFloat(),prefs.optDouble("leading",1.8).toFloat(),prefs.optString("theme","system"),event.optBoolean("busy"),event.optString("error"))
        }
    }
}
