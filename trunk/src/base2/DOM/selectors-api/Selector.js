
// This object can be instantiated, however it is probably better to use
// the querySelector/querySelectorAll methods on DOM nodes.

// There is no public standard for this object.

var Selector = Base.extend({
  constructor: function(selector) {
    this.toString = K(trim(selector));
    if (!_parser.exec) _parser = new CSSParser(_parser);
  },

  exec: function(context, count, simple) {
    return Selector.parse(this, simple)(context, count);
  },

  getSpecificity: function() {
    var selector = _parser.escape(this);
    if (selector.indexOf(",") == -1) {
    	return match(selector, _SPECIFICITY_ID).length * 10000 +
    		match(selector, _SPECIFICITY_CLASS).length * 100 +
    		match(selector, _SPECIFICITY_TAG).length;
    } else {
      return -1;
    }
  },

  isPseudo: function() {
    return _PSEUDO.test(_parser.escape(this));
  },

  isSimple: function() {
    return !_COMBINATOR.test(trim(_parser.escape(this)));
  },

  split: function() {
    return Array2.map(_parser.escape(this).split(","), function(selector) {
      return new Selector(_parser.unescape(selector));
    });
  },

  test: function(element) {
    if (this.isSimple()) {
      return !!Selector.parse(this, true)(element, 1);
    } else {
      element.setAttribute("b2-test", true);
      var result = new Selector(this + "[b2-test]").exec(Traversal.getOwnerDocument(element), 1);
      element.removeAttribute("b2-test");
      return result == element;
    }
  },

  toXPath: function(simple) {
    return Selector.toXPath(this, simple);
  },

  "@(XPathResult)": {
    exec: function(context, count, simple) {
      // use DOM methods if the XPath engine can't be used
      if (_NOT_XPATH.test(this)) {
        return this.base(context, count, simple);
      }
      var document = Traversal.getDocument(context);
      var type = count == 1
        ? 9 /* FIRST_ORDERED_NODE_TYPE */
        : 7 /* ORDERED_NODE_SNAPSHOT_TYPE */;
      var result = document.evaluate(this.toXPath(simple), context, null, type, null);
      return count == 1 ? result.singleNodeValue : result;
    }
  },

  "@MSIE": {
    exec: function(context, count, simple) {
      if (typeof context.selectNodes != "undefined" && !_NOT_XPATH.test(this)) { // xml
        var method = count == 1 ? "selectSingleNode" : "selectNodes";
        return context[method](this.toXPath(simple));
      }
      return this.base(context, count, simple);
    }
  },

  "@(true)": {
    exec: function(context, count, simple) {
      try {
        var result = this.base(context || document, count, simple);
      } catch (error) { // probably an invalid selector =)
        throw new SyntaxError(format("'%1' is not a valid CSS selector.", this));
      }
      return count == 1 ? result : new StaticNodeList(result);
    }
  }
}, {
  toXPath: function(selector, simple) {
    if (!_xpathParser) _xpathParser = new XPathParser;
    return _xpathParser.parse(selector, simple);
  }
});

var _SPECIFICITY_ID = /#/g,
    _SPECIFICITY_CLASS = /[.:\[]/g,
    _SPECIFICITY_TAG = /^\w|[\s>+~]\w/g;
    
var _COMBINATOR = /[^,]\s|[+>~]/,
    _PSEUDO = /:/;

var _NOT_XPATH = ":(checked|disabled|enabled|contains|hover|active|focus|link|visited)|^(#[\\w-]+\\s*)?\\w+$";
if (detect("KHTML")) {
  if (detect("WebKit5")) {
    _NOT_XPATH += "|nth\\-|,";
  } else {
    _NOT_XPATH = ".";
  }
}
_NOT_XPATH = new RegExp(_NOT_XPATH);

// Selector.parse() - converts CSS selectors to DOM queries.

// Hideous code but it produces fast DOM queries.
// Respect due to Alex Russell and Jack Slocum for inspiration.

Selector.operators = {
  "=":  "%1=='%2'",
//"!=": "%1!='%2'", //  not standard but other libraries support it
  "~=": /(^| )%1( |$)/,
  "|=": /^%1(-|$)/,
  "^=": /^%1/,
  "$=": /%1$/,
  "*=": /%1/
};
Selector.operators[""] = "%1!=null";

Selector.pseudoClasses = { //-dean: lang()
  "checked":     "e%1.checked",
  "contains":    "e%1[TEXT].indexOf('%2')!=-1",
  "disabled":    "e%1.disabled",
  "empty":       "Traversal.isEmpty(e%1)",
  "enabled":     "e%1.disabled===false",
  "first-child": "!Traversal.getPreviousElementSibling(e%1)",
  "last-child":  "!Traversal.getNextElementSibling(e%1)",
  "only-child":  "!Traversal.getPreviousElementSibling(e%1)&&!Traversal.getNextElementSibling(e%1)",
  "root":        "e%1==Traversal.getDocument(e%1).documentElement",
  "target":      "e%1.id&&e%1.id==location.hash.slice(1)",
  "hover":       "DocumentState.getInstance(d).isHover(e%1)",
  "active":      "DocumentState.getInstance(d).isActive(e%1)",
  "focus":       "DocumentState.getInstance(d).hasFocus(e%1)",
  "link":        "d.links&&Array2.contains(d.links,e%1)",
  "visited":     "false" // not implemented (security)
// nth-child     // defined below
// not
};

var _INDEXED = document.documentElement.sourceIndex !== undefined,
    _VAR = "var p%2=0,i%2,e%3,n%2=e%1.",
    _ID = _INDEXED ? "e%1.sourceIndex" : "assignID(e%1)",
    _TEST = "var g=" + _ID + ";if(!p[g]){p[g]=1;",
    _STORE = "r[k++]=e%1;if(s==1)return e%1;if(k===s){_query.state=[%2];_query.complete=%3;return r;",
    _FN = "var _query=function(e0,s%1){_indexed++;var r=[],p={},p0=0,reg=[%4],d=Traversal.getDocument(e0),c=d.writeln?'toUpperCase':'toString',k=0;";

var _xpathParser;

// variables used by the parser

var _reg,        // a store for RexExp objects
    _index,
    _wild,       // need to flag certain wild card selectors as MSIE includes comment nodes
    _list,       // are we processing a node list?
    _group,
    _listAll,
    _duplicate,  // possible duplicates?
    _cache = {}, // store parsed selectors
    _simple = {};

function sum(list) {
  var total = 0;
  for (var i = 0; i < list.length; i++) {
    total += list[i];
  }
  return total;
};

// a hideous parser
var _parser = {
  "^(\\*|[ID]+)": function(match, tagName) {
    return tagName == "*" ? "" : format("if(e0.nodeName=='%1'[c]()){", tagName);
  },

  "^ \\*:root": function(match) { // :root pseudo class
    _wild = false;
    var replacement = "e%2=d.documentElement;if(Traversal.contains(e%1,e%2)){";
    return format(replacement, _index++, _index);
  },

  " (\\*|[ID]+)#([ID]+)": function(match, tagName, id) { // descendant selector followed by ID
    _wild = false;
    var replacement = "var e%2=_byId(d,'%4');if(e%2&&";
    if (tagName != "*") replacement += "e%2.nodeName=='%3'[c]()&&";
    replacement += "Traversal.contains(e%1,e%2)){";
    if (_list[_group]) replacement += format("i%1=n%1.length;", sum(_list));
    return format(replacement, _index++, _index, tagName, id);
  },

  " (\\*|[ID]+)": function(match, tagName) { // descendant selector
    _duplicate++; // this selector may produce duplicates
    _wild = tagName == "*";
    var replacement = format(_VAR, _index++, "%2", _index);
    // IE5.x does not support getElementsByTagName("*");
    replacement += (_wild && _MSIE5) ? "all" : "getElementsByTagName('%3')";
    replacement += ";for(i%2=a%2||0;(e%1=n%2[i%2]);i%2++){";
    _list[_group]++;
    return format(replacement, _index, sum(_list), tagName);
  },

  ">(\\*|[ID]+)": function(match, tagName) { // child selector
    var children = _MSIE && _index;
    _wild = tagName == "*";
    var replacement = _VAR + (children ? "children" : "childNodes");
    replacement = format(replacement, _index++, "%2", _index);
    if (!_wild && _MSIE && children) replacement += ".tags('%3')";
    replacement += ";for(i%2=a%2||0;(e%1=n%2[i%2]);i%2++){";
    if (_wild) {
      replacement += "if(e%1.nodeType==1){";
      _wild = _MSIE5;
    } else {
      if (!_MSIE || !children) replacement += "if(e%1.nodeName=='%3'[c]()){";
    }
    _list[_group]++;
    return format(replacement, _index, sum(_list), tagName);
  },

  "\\+(\\*|[ID]+)": function(match, tagName) { // direct adjacent selector
    var replacement = "";
    if (_wild && _MSIE) replacement += "if(e%1.nodeName!='!'){";
    _wild = false;
    replacement += "e%1=Traversal.getNextElementSibling(e%1);if(e%1";
    if (tagName != "*") replacement += "&&e%1.nodeName=='%2'[c]()";
    replacement += "){";
    return format(replacement, _index, tagName);
  },

  "~(\\*|[ID]+)": function(match, tagName) { // indirect adjacent selector
    var replacement = "";
    if (_wild && _MSIE) replacement += "if(e%1.nodeName!='!'){";
    _wild = false;
    _duplicate = 2; // this selector may produce duplicates
    replacement += "while(e%1=e%1.nextSibling){if(e%1.b2_adjacent==_indexed)break;if(";
    if (tagName == "*") {
      replacement += "e%1.nodeType==1";
      if (_MSIE5) replacement += "&&e%1.nodeName!='!'";
    } else replacement += "e%1.nodeName=='%2'[c]()";
    replacement += "){e%1.b2_adjacent=_indexed;";
    return format(replacement, _index, tagName);
  },

  "#([ID]+)": function(match, id) { // ID selector
    _wild = false;
    var replacement = "if(e%1.id=='%2'){";
    if (_list[_group]) replacement += format("i%1=n%1.length;", sum(_list));
    return format(replacement, _index, id);
  },

  "\\.([ID]+)": function(match, className) { // class selector
    _wild = false;
    // store RegExp objects - slightly faster on IE
    _reg.push(new RegExp("(^|\\s)" + rescape(className) + "(\\s|$)"));
    return format("if(e%1.className&&reg[%2].test(e%1.className)){", _index, _reg.length - 1);
  },

  ":not\\((\\*|[ID]+)?([^)]*)\\)": function(match, tagName, filters) { // :not pseudo class
    var replacement = (tagName && tagName != "*") ? format("if(e%1.nodeName=='%2'[c]()){", _index, tagName) : "";
    replacement += _parser.exec(filters);
    return "if(!" + replacement.slice(2, -1).replace(/\)\{if\(/g, "&&") + "){";
  },

  ":nth(-last)?-child\\(([^)]+)\\)": function(match, last, args) { // :nth-child pseudo classes
    _wild = false;
    last = format("e%1.parentNode.b2_length", _index);
    var replacement = "if(p%1!==e%1.parentNode)p%1=_register(e%1.parentNode);";
    replacement += "var i=e%1[p%1.b2_lookup];if(p%1.b2_lookup!='b2_index')i++;if(";
    return format(replacement, _index) + _nthChild(match, args, "i", last, "!", "&&", "% ", "==") + "){";
  },

  ":([ID]+)(\\(([^)]+)\\))?": function(match, pseudoClass, $2, args) { // other pseudo class selectors
    return "if(" + format(Selector.pseudoClasses[pseudoClass] || "throw", _index, args || "") + "){";
  },

  "\\[\\s*([ID]+)\\s*([^=]?=)?\\s*([^\\]\\s]*)\\s*\\]": function(match, attr, operator, value) { // attribute selectors
    value = trim(value);
    if (_MSIE) {
      var getAttribute = "Element.getAttribute(e%1,'%2')";
    } else {
      getAttribute = "e%1.getAttribute('%2')";
    }
    getAttribute = format(getAttribute, _index, attr);
    var replacement = Selector.operators[operator || ""];
    if (instanceOf(replacement, RegExp)) {
      _reg.push(new RegExp(format(replacement.source, rescape(_parser.unescape(value)))));
      replacement = "reg[%2].test(%1)";
      value = _reg.length - 1;
    }
    return "if(" + format(replacement, getAttribute, value) + "){";
  }
};

(function(_no_shrink_) {
  // IE confuses the name attribute with id for form elements,
  // use document.all to retrieve elements with name/id instead
  var _byId = detect("MSIE[5-7]") ? function(document, id) {
    var result = document.all[id] || null;
    // returns a single element or a collection
    if (!result || result.id == id) return result;
    // document.all has returned a collection of elements with name/id
    for (var i = 0; i < result.length; i++) {
      if (result[i].id == id) return result[i];
    }
    return null;
  } : function(document, id) {
    return document.getElementById(id);
  };

  // register a node and index its children
  var _indexed = 1;
  function _register(element) {
    if (element.rows) {
      element.b2_length = element.rows.length;
      element.b2_lookup = "rowIndex";
    } else if (element.cells) {
      element.b2_length = element.cells.length;
      element.b2_lookup = "cellIndex";
    } else if (element.b2_indexed != _indexed) {
      var index = 0;
      var child = element.firstChild;
      while (child) {
        if (child.nodeType == 1 && child.nodeName != "!") {
          child.b2_index = ++index;
        }
        child = child.nextSibling;
      }
      element.b2_length = index;
      element.b2_lookup = "b2_index";
    }
    element.b2_indexed = _indexed;
    return element;
  };

  Selector.parse = function(selector, simple) {
    var cache = simple ? _simple : _cache;
    if (!cache[selector]) {
      _reg = []; // store for RegExp objects
      _list = [];
      var fn = "";
      var selectors = _parser.escape(selector, simple).split(",");
      for (_group = 0; _group < selectors.length; _group++) {
        _wild = _index = _list[_group] = 0; // reset
        _duplicate = selectors.length > 1 ? 2 : 0; // reset
        var block = _parser.exec(selectors[_group]) || "throw;";
        if (_wild && _MSIE) { // IE's pesky comment nodes
          block += format("if(e%1.tagName!='!'){", _index);
        }
        // check for duplicates before storing results
        var store = (_duplicate > 1) ? _TEST : "";
        block += format(store + _STORE, _index, "%2");
        // add closing braces
        block += Array(match(block, /\{/g).length + 1).join("}");
        fn += block;
      }
      fn = _parser.unescape(fn);
      if (selectors.length > 1) fn += "r.unsorted=1;";
      var args = "";
      var state = [];
      var total = sum(_list);
      for (var i = 1; i <= total; i++) {
        args += ",a" + i;
        state.push("i" + i + "?(i" + i + "-1):0");
      }
      if (total) {
        var complete = [], k = 0;
        for (var i = 0; i < _group; i++) {
          k += _list[i];
          if (_list[i]) complete.push(format("n%1&&i%1==n%1.length", k));
        }
      }
      fn += "_query.state=[%2];_query.complete=%3;return s==1?null:r}";
      eval(format(_FN + fn, args, state.join(","), total ? complete.join("&&") : true, _reg));
      cache[selector] = _query;
    }
    return cache[selector];
  };
})();
