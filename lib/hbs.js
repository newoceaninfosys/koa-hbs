'use strict';

var _fs = require('fs');

var _fs2 = _interopRequireDefault(_fs);

var _path = require('path');

var _path2 = _interopRequireDefault(_path);

var _glob = require('glob');

var _glob2 = _interopRequireDefault(_glob);

var _util = require('util');

var _util2 = _interopRequireDefault(_util);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _asyncToGenerator(fn) { return function () { var gen = fn.apply(this, arguments); return new Promise(function (resolve, reject) { function step(key, arg) { try { var info = gen[key](arg); var value = info.value; } catch (error) { reject(error); return; } if (info.done) { resolve(value); } else { return Promise.resolve(value).then(function (value) { step("next", value); }, function (err) { step("throw", err); }); } } return step("next"); }); }; }

/* Capture the layout name; thanks express-hbs */
const rLayoutPattern = /{{!<\s+([A-Za-z0-9\._\-\/]+)\s*}}/;

/**
 * Shallow copy two objects into a new object
 *
 * Objects are merged from left to right. Thus, properties in objects further
 * to the right are preferred over those on the left.
 *
 * @param {object} obj1
 * @param {object} obj2
 * @returns {object}
 * @api private
 */

function merge(obj1, obj2) {
  var c = {},
      keys = Object.keys(obj2),
      i;

  for (i = 0; i !== keys.length; i++) {
    c[keys[i]] = obj2[keys[i]];
  }

  keys = Object.keys(obj1);
  for (i = 0; i !== keys.length; i++) {
    if (!c.hasOwnProperty(keys[i])) {
      c[keys[i]] = obj1[keys[i]];
    }
  }

  return c;
};

/**
 * Opens a file and returns its contents
 * @param {String} filename  Name of file to read
 * @return {Promise}
 */
function read(filename) {
  return new Promise((resolve, reject) => {
    _fs2.default.readFile(filename, { encoding: 'utf8' }, (err, data) => {
      if (err) {
        return reject(err);
      }

      resolve(data);
    });
  });
};

/**
 * @class MissingTemplateError
 * @param {String} message The error message
 * @param {Object} extra   The value of the template, relating to the error.
 */
function MissingTemplateError(message, extra) {
  Error.captureStackTrace(this, this.constructor);
  this.name = this.constructor.name;
  this.message = message;
  this.extra = extra;
};

_util2.default.inherits(MissingTemplateError, Error);

/**
 * @class BadOptionsError
 * @param {String} message The error message
 * @param {Object} extra   Misc infomration.
 */
function BadOptionsError(message, extra) {
  Error.captureStackTrace(this, this.constructor);
  this.name = this.constructor.name;
  this.message = message;
  this.extra = extra;
};

_util2.default.inherits(BadOptionsError, Error);

/**
 * expose default instance of `Hbs`
 */

exports = module.exports = new Hbs();

/**
 * expose method to create additional instances of `Hbs`
 */

exports.create = function () {
  return new Hbs();
};

/**
 * Create new instance of `Hbs`
 *
 * @api public
 */
function Hbs() {
  if (!(this instanceof Hbs)) {
    return new Hbs();
  }

  this.handlebars = require('handlebars').create();

  this.Utils = this.handlebars.Utils;
  this.SafeString = this.handlebars.SafeString;
}

/**
 * Configure the instance.
 *
 * @api private
 */

Hbs.prototype.configure = function (options) {

  var self = this;

  if (!options.viewsPath) {
    throw new BadOptionsError('The option `viewsPath` must be specified.');
  }

  // Attach options
  options = options || {};
  this.viewsPath = options.viewsPath;
  this.handlebars = options.handlebars || this.handlebars;
  this.templateOptions = options.templateOptions || {};
  this.extname = options.extname || '.hbs';
  this.partialsPath = options.partialsPath || [];
  this.contentHelperName = options.contentHelperName || 'contentFor';
  this.blockHelperName = options.blockHelperName || 'block';
  this.defaultLayout = options.defaultLayout || '';
  this.layoutsPath = options.layoutsPath || '';
  this.locals = options.locals || {};
  this.disableCache = options.disableCache || false;
  this.partialsRegistered = false;

  if (!Array.isArray(this.viewsPath)) {
    this.viewsPath = [this.viewsPath];
  }

  // Cache templates and layouts
  this.cache = {};

  this.blocks = {};

  // block helper
  this.registerHelper(this.blockHelperName, function (name, options) {
    // instead of returning self.block(name), render the default content if no
    // block is given
    let val = self.block(name);

    if (val === '' && typeof options.fn === 'function') {
      val = options.fn(this);
    }

    return val;
  });

  // contentFor helper
  this.registerHelper(this.contentHelperName, function (name, options) {
    return self.content(name, options, this);
  });

  return this;
};

/**
 * Middleware for koa
 *
 * @api public
 */

Hbs.prototype.middleware = function (options) {
  this.configure(options);

  let render = this.createRenderer();

  return (() => {
    var _ref = _asyncToGenerator(function* (ctx, next) {
      ctx.render = render;
      yield next();
    });

    return function (_x, _x2) {
      return _ref.apply(this, arguments);
    };
  })();
};

/**
 * Create a render generator to be attached to koa context
 */

Hbs.prototype.createRenderer = function () {
  let hbs = this;

  return (() => {
    var _ref2 = _asyncToGenerator(function* (tpl, locals) {
      let tplPath = hbs.getTemplatePath(tpl),
          template,
          rawTemplate,
          layoutTemplate;

      if (!tplPath) {
        throw new MissingTemplateError('The template specified does not exist.', tplPath);
      }

      // allow absolute paths to be used
      if (_path2.default.isAbsolute(tpl)) {
        tplPath = tpl + hbs.extname;
      }

      locals = merge(this.state || {}, locals || {});
      locals = merge(hbs.locals, locals);

      // Initialization... move these actions into another function to remove
      // unnecessary checks
      if (hbs.disableCache || !hbs.partialsRegistered && hbs.partialsPath !== '') {
        yield hbs.registerPartials();
      }

      // Load the template
      if (hbs.disableCache || !hbs.cache[tpl]) {
        rawTemplate = yield read(tplPath);
        hbs.cache[tpl] = {
          template: hbs.handlebars.compile(rawTemplate)
        };

        // Load layout if specified
        if (typeof locals.layout !== 'undefined' || rLayoutPattern.test(rawTemplate)) {
          let layout = locals.layout;

          if (typeof layout === 'undefined') {
            layout = rLayoutPattern.exec(rawTemplate)[1];
          }

          if (layout !== false) {
            let rawLayout = yield hbs.loadLayoutFile(layout);
            hbs.cache[tpl].layoutTemplate = hbs.handlebars.compile(rawLayout);
          } else {
            hbs.cache[tpl].layoutTemplate = hbs.handlebars.compile('{{{body}}}');
          }
        }
      }

      template = hbs.cache[tpl].template;
      layoutTemplate = hbs.cache[tpl].layoutTemplate;

      if (!layoutTemplate) {
        layoutTemplate = yield hbs.getLayoutTemplate();
      }

      // Add the current koa context to templateOptions.data to provide access
      // to the request within helpers.
      if (!hbs.templateOptions.data) {
        hbs.templateOptions.data = {};
      }

      hbs.templateOptions.data = merge(hbs.templateOptions.data, { koa: this });

      // Run the compiled templates
      locals.body = template(locals, hbs.templateOptions);
      this.body = layoutTemplate(locals, hbs.templateOptions);
    });

    return function (_x3, _x4) {
      return _ref2.apply(this, arguments);
    };
  })();
};

/**
 * Get layout path
 */

Hbs.prototype.getLayoutPath = function (layout) {
  if (this.layoutsPath) {
    return _path2.default.join(this.layoutsPath, layout + this.extname);
  }

  return _path2.default.join(this.viewsPath[0], layout + this.extname);
};

/**
 * Lazy load default layout in cache.
 */
Hbs.prototype.getLayoutTemplate = _asyncToGenerator(function* () {
  if (this.disableCache || !this.layoutTemplate) {
    this.layoutTemplate = yield this.cacheLayout();
  }

  return this.layoutTemplate;
});

/**
 * Get a default layout. If none is provided, make a noop
 */

Hbs.prototype.cacheLayout = (() => {
  var _ref4 = _asyncToGenerator(function* (layout) {
    let hbs = this,
        layoutTemplate;

    // Create a default layout to always use
    if (!layout && !hbs.defaultLayout) {
      return hbs.handlebars.compile('{{{body}}}');
    }

    // Compile the default layout if one not passed
    if (!layout) {
      layout = hbs.defaultLayout;
    }

    try {
      let rawLayout = yield hbs.loadLayoutFile(layout);
      layoutTemplate = hbs.handlebars.compile(rawLayout);
    } catch (err) {
      console.error(err.stack);
    }

    return layoutTemplate;
  });

  return function (_x5) {
    return _ref4.apply(this, arguments);
  };
})();

/**
 * Load a layout file
 */

Hbs.prototype.loadLayoutFile = function (layout) {
  let file = this.getLayoutPath(layout);
  return read(file);
};

/**
 * Register helper to internal handlebars instance
 */

Hbs.prototype.registerHelper = function () {
  this.handlebars.registerHelper.apply(this.handlebars, arguments);
};

/**
 * Register partial with internal handlebars instance
 */

Hbs.prototype.registerPartial = function () {
  this.handlebars.registerPartial.apply(this.handlebars, arguments);
};

/**
 * Register directory of partials
 */

Hbs.prototype.registerPartials = _asyncToGenerator(function* () {
  let self = this;

  if (!Array.isArray(this.partialsPath)) {
    this.partialsPath = [this.partialsPath];
  }

  function readdir(root) {
    return new Promise((resolve, reject) => {
      (0, _glob2.default)('**/*' + self.extname, { cwd: root }, (err, files) => {
        if (err) {
          return reject(err);
        }

        resolve(files);
      });
    });
  };

  // Read partials and register them
  try {
    let resultList = yield Promise.all(self.partialsPath.map(readdir)),
        files = [],
        names = [],
        partials,
        i;

    if (!resultList.length) {
      return;
    }

    // Generate list of files and template names
    resultList.forEach(function (result, i) {
      result.forEach(function (file) {
        files.push(_path2.default.join(self.partialsPath[i], file));
        names.push(file.slice(0, -1 * self.extname.length));
      });
    });

    // Read all the partials from disk
    partials = yield Promise.all(files.map(read));

    for (i = 0; i !== partials.length; i++) {
      self.registerPartial(names[i], partials[i]);
    }

    self.partialsRegistered = true;
  } catch (e) {
    console.error('Error caught while registering partials');
    console.error(e);
  }
});

Hbs.prototype.getTemplatePath = function (tpl) {
  let cache = this.pathCache || (this.pathCache = {}),
      i;

  if (cache[tpl]) return cache[tpl];

  for (i = 0; i !== this.viewsPath.length; i++) {
    let viewsPath = this.viewsPath[i],
        tplPath = _path2.default.join(viewsPath, tpl + this.extname);

    try {
      _fs2.default.statSync(tplPath);
      if (!this.disableCache) cache[tpl] = tplPath;

      return tplPath;
    } catch (e) {
      continue;
    }
  }

  return void 0;
};

/**
 * The contentFor helper delegates to here to populate block content
 */

Hbs.prototype.content = function (name, options, context) {
  // fetch block
  let block = this.blocks[name] || (this.blocks[name] = []);

  // render block and save for layout render
  block.push(options.fn(context));
};

/**
 * block helper delegates to this function to retreive content
 */

Hbs.prototype.block = function (name) {
  // val = block.toString
  let val = (this.blocks[name] || []).join('\n');

  // clear the block
  this.blocks[name] = [];
  return val;
};