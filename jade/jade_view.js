// Copyright (C) 2011-2014 Massachusetts Institute of Technology
// Chris Terman

// make jslint happy
//var JSON,$;

var jade_view = (function() {

    //////////////////////////////////////////////////////////////////////
    //
    // Diagram editor base class
    //
    //////////////////////////////////////////////////////////////////////

    function Diagram(editor, class_name) {
        this.editor = editor;
        this.aspect = undefined;

        // setup canas
        this.canvas = $('<canvas></canvas>').addClass(class_name)[0];

        // handle retina devices properly
        var context = this.canvas.getContext('2d');
        var devicePixelRatio = window.devicePixelRatio || 1;
        var backingStoreRatio = context.webkitBackingStorePixelRatio ||
            context.mozBackingStorePixelRatio ||
            context.msBackingStorePixelRatio ||
            context.oBackingStorePixelRatio ||
            context.backingStorePixelRatio || 1;
        this.pixelRatio = devicePixelRatio / backingStoreRatio;

        this.sctl_r = 16; // scrolling control parameters
        this.sctl_x = this.sctl_r + 8; // upper left
        this.sctl_y = this.sctl_r + 8;
        this.zctl_left = this.sctl_x - 8;
        this.zctl_top = this.sctl_y + this.sctl_r + 8;

        // ethanschoonover.com
        this.background_style = 'rgb(250,250,250)'; // backgrund color for diagram [base3]
        this.grid_style = 'rgb(230,230,230)'; // grid on background
        this.control_style = 'rgb(180,180,180)'; // grid on background [base1]
        this.normal_style = 'rgb(88,110,117)'; // default drawing color [base01]
        this.component_style = 'rgb(38,139,210)'; // color for unselected components [blue]
        this.selected_style = 'rgb(211,54,130)'; // highlight color for selected components [magenta]
        this.annotation_style = 'rgb(220,50,47)'; // color for diagram annotations [red]

        this.property_font = '5pt sans-serif'; // point size for Component property text
        this.annotation_font = '6pt sans-serif'; // point size for diagram annotations

        // repaint simply draws this buffer and then adds selected elements on top
        this.bg_image = $('<canvas></canvas>')[0];
        this.bg_image.getContext('2d').scale(this.pixelRatio,this.pixelRatio);

        this.canvas.tabIndex = 1; // so we get keystrokes

        this.canvas.diagram = this;

        // initial state
        this.dragging = false;
        this.select_rect = undefined;
        this.annotations = [];
        this.show_grid = true;

        this.origin_x = 0;
        this.origin_y = 0;
        this.cursor_x = 0;
        this.cursor_y = 0;
        this.unsel_bbox = [Infinity, Infinity, - Infinity, - Infinity];
        this.bbox = [0, 0, 0, 0];
    }

    Diagram.prototype.netlist = function(mlist) {
        try {
            var netlist = this.aspect.netlist(mlist, '', {});
            return netlist;
        }
        catch (e) {
            //throw e;  // for debugging
            alert("Error extracting netlist:\n\n" + e);
            return [];
        }
    };

    // fetch attributes from the tag that created us
    Diagram.prototype.getAttribute = function(attr) {
        return undefined;
    };

    Diagram.prototype.set_aspect = function(aspect) {
        this.aspect = aspect;
        this.show_grid = true;

        this.bbox = this.aspect.compute_bbox();
        //this.redraw_background(); // compute bounding box
        this.zoomall(); // let's see the whole diagram
    };

    Diagram.prototype.unselect_all = function(which) {
        this.annotations = []; // remove all annotations

        this.aspect.map_over_components(function(c, i) {
            if (i != which) c.set_select(false);
        });
    };

    Diagram.prototype.remove_annotations = function() {
        this.unselect_all();
        this.redraw_background();
    };

    Diagram.prototype.add_annotation = function(callback) {
        this.annotations.push(callback);
        this.redraw();
    };

    Diagram.prototype.drag_begin = function() {
        // let components know they're about to move
        var cursor_grid = 1;
        this.aspect.map_over_components(function(c) {
            if (c.selected) {
                c.move_begin();
                cursor_grid = Math.max(cursor_grid, c.required_grid);
            }
        });
        this.set_cursor_grid(cursor_grid);

        // remember where drag started
        this.drag_x = this.cursor_x;
        this.drag_y = this.cursor_y;
        this.dragging = true;
    };

    Diagram.prototype.drag_end = function() {
        // let components know they're done moving
        this.aspect.map_over_components(function(c) {
            if (c.selected) c.move_end();
        });
        this.dragging = false;
        this.aspect.end_action();
        this.redraw_background();
    };

    Diagram.prototype.zoomin = function() {
        var nscale = this.scale * this.zoom_factor;

        if (nscale < this.zoom_max) {
            // keep center of view unchanged
            this.origin_x += (this.canvas.clientWidth / 2) * (1.0 / this.scale - 1.0 / nscale);
            this.origin_y += (this.canvas.clientHeight / 2) * (1.0 / this.scale - 1.0 / nscale);
            this.scale = nscale;
            this.redraw_background();
        }
    };

    Diagram.prototype.zoomout = function() {
        var nscale = this.scale / this.zoom_factor;

        if (nscale > this.zoom_min) {
            // keep center of view unchanged
            this.origin_x += (this.canvas.clientWidth / 2) * (1.0 / this.scale - 1.0 / nscale);
            this.origin_y += (this.canvas.clientHeight / 2) * (1.0 / this.scale - 1.0 / nscale);
            this.scale = nscale;
            this.redraw_background();
        }
    };

    Diagram.prototype.zoomall = function() {
        // w,h for diagram including a margin on all sides
        var diagram_w = 1.5 * (this.bbox[2] - this.bbox[0]);
        var diagram_h = 1.5 * (this.bbox[3] - this.bbox[1]);

        if (diagram_w === 0) this.scale = 1;
        else {
            // compute scales that would make diagram fit, choose smallest
            var scale_x = this.canvas.clientWidth / diagram_w;
            var scale_y = this.canvas.clientHeight / diagram_h;
            this.scale = Math.pow(this.zoom_factor,
                                  Math.ceil(Math.log(Math.min(scale_x, scale_y)) / Math.log(this.zoom_factor)));
            if (this.scale < this.zoom_min) this.scale = this.zoom_min;
            else if (this.scale > this.zoom_max) this.scale = this.zoom_max;
        }

        // center the diagram
        this.origin_x = (this.bbox[2] + this.bbox[0]) / 2 - this.canvas.clientWidth / (2 * this.scale);
        this.origin_y = (this.bbox[3] + this.bbox[1]) / 2 - this.canvas.clientHeight / (2 * this.scale);

        this.redraw_background();
    };

    function diagram_undo(diagram) {
        diagram.aspect.undo();
        diagram.unselect_all(-1);
        diagram.redraw_background();
    }

    function diagram_redo(diagram) {
        diagram.aspect.redo();
        diagram.unselect_all(-1);
        diagram.redraw_background();
    }

    function diagram_cut(diagram) {
        // clear previous contents
        clipboards[diagram.editor.editor_name] = [];

        // look for selected components, move them to clipboard.
        diagram.aspect.start_action();
        diagram.aspect.map_over_components(function(c) {
            if (c.selected) {
                c.remove();
                clipboards[diagram.editor.editor_name].push(c);
            }
        });
        diagram.aspect.end_action();

        // update diagram view
        diagram.redraw();
    }

    function diagram_copy(diagram) {
        // clear previous contents
        clipboards[diagram.editor.editor_name] = [];

        // look for selected components, copy them to clipboard.
        diagram.aspect.map_over_components(function(c) {
            if (c.selected) clipboards[diagram.editor.editor_name].push(c.clone(c.coords[0], c.coords[1]));
        });

        diagram.redraw(); // digram didn't change, but toolbar status may have
    }

    function diagram_paste(diagram) {
        var clipboard = clipboards[diagram.editor.editor_name];
        var i, c;

        // compute left,top of bounding box for origins of
        // components in the clipboard
        var left;
        var top;
        var cursor_grid = 1;
        for (i = clipboard.length - 1; i >= 0; i -= 1) {
            c = clipboard[i];
            left = left ? Math.min(left, c.coords[0]) : c.coords[0];
            top = top ? Math.min(top, c.coords[1]) : c.coords[1];
            cursor_grid = Math.max(cursor_grid, c.required_grid);
        }
        diagram.set_cursor_grid(cursor_grid);
        left = diagram.on_grid(left);
        top = diagram.on_grid(top);

        // clear current selections
        diagram.unselect_all(-1);
        diagram.redraw_background(); // so we see any components that got unselected

        // make clones of components on the clipboard, positioning
        // them relative to the cursor
        diagram.aspect.start_action();
        for (i = clipboard.length - 1; i >= 0; i -= 1) {
            c = clipboard[i];
            var new_c = c.clone(diagram.cursor_x + (c.coords[0] - left), diagram.cursor_y + (c.coords[1] - top));
            new_c.set_select(true);
            new_c.add(diagram.aspect);
        }
        diagram.aspect.end_action();

        // see what we've wrought
        diagram.redraw();
    }

    Diagram.prototype.set_cursor_grid = function(g) {
        this.cursor_grid = g;
        this.cursor_x = this.on_grid(this.aspect_x);
        this.cursor_y = this.on_grid(this.aspect_y);
    };

    // determine nearest grid point
    Diagram.prototype.on_grid = function(v, grid) {
        if (grid === undefined) grid = this.cursor_grid;
        if (v < 0) return Math.floor((-v + (grid >> 1)) / grid) * -grid;
        else return Math.floor((v + (grid >> 1)) / grid) * grid;
    };

    // rotate selection about center of its bounding box
    Diagram.prototype.rotate = function(rotation) {
        var bbox = this.aspect.selected_bbox();
        var grid = this.aspect.selected_grid();

        // compute center of bounding box, ensure it's on grid
        var cx = this.on_grid((bbox[0] + bbox[2]) >> 1, grid);
        var cy = this.on_grid((bbox[1] + bbox[3]) >> 1, grid);

        this.aspect.start_action();

        // rotate each selected component relative center of bbox
        this.aspect.map_over_components(function(c) {
            if (c.selected) {
                c.move_begin();
                c.rotate(rotation, cx, cy);
            }
        });

        // to prevent creep, recompute bounding box and move
        // to old center
        bbox = this.aspect.selected_bbox();
        var dx = cx - this.on_grid((bbox[0] + bbox[2]) >> 1, grid);
        var dy = cy - this.on_grid((bbox[1] + bbox[3]) >> 1, grid);
        this.aspect.map_over_components(function(c) {
            if (c.selected) {
                if (dx !== 0 || dy !== 0) c.move(dx, dy);
                c.move_end();
            }
        });
        this.aspect.end_action();
        this.redraw();
    };

    // flip selection horizontally
    function diagram_fliph(diagram) {
        diagram.rotate(4);
    }

    // flip selection vertically
    function diagram_flipv(diagram) {
        diagram.rotate(6);
    }

    // rotate selection clockwise
    function diagram_rotcw(diagram) {
        diagram.rotate(1);
    }

    // rotate selection counterclockwise
    function diagram_rotccw(diagram) {
        diagram.rotate(3);
    }

    Diagram.prototype.resize = function() {
        var w = $(this.canvas).width(); //this.canvas.clientWidth;
        var h = $(this.canvas).height(); //this.canvas.clientHeight;

        this.canvas.width = w*this.pixelRatio;
        this.canvas.height = h*this.pixelRatio;
        // after changing dimension, have to reset context 
        this.canvas.getContext('2d').scale(this.pixelRatio,this.pixelRatio);

        this.bg_image.width = w*this.pixelRatio;
        this.bg_image.height = h*this.pixelRatio;
        this.bg_image.getContext('2d').scale(this.pixelRatio,this.pixelRatio);

        this.zoomall();
    };

    ///////////////////////////////////////////////////////////////////////////////
    //
    //  Drawing support -- deals with scaling and scrolling of diagrams
    //
    ////////////////////////////////////////////////////////////////////////////////

    // here to redraw background image containing static portions of the diagram
    // Also redraws dynamic portion.
    Diagram.prototype.redraw_background = function() {
        var c = this.bg_image.getContext('2d');
        this.c = c;

        c.lineCap = 'round';

        // paint background color -- use color from style sheet
        c.fillStyle = this.show_grid ? this.background_style : 'white';
        c.fillRect(0, 0, this.canvas.clientWidth, this.canvas.clientHeight);

        if (!this.diagram_only && this.show_grid) {
            // grid
            c.strokeStyle = this.grid_style;
            var first_x = this.origin_x;
            var last_x = first_x + this.canvas.clientWidth / this.scale;
            var first_y = this.origin_y;
            var last_y = first_y + this.canvas.clientHeight / this.scale;
            var i;

            for (i = this.grid * Math.ceil(first_x / this.grid); i < last_x; i += this.grid) {
                this.draw_line(i, first_y, i, last_y, 0.2);
            }

            for (i = this.grid * Math.ceil(first_y / this.grid); i < last_y; i += this.grid) {
                this.draw_line(first_x, i, last_x, i, 0.2);
            }

            // indicate origin
            this.draw_arc(0, 0, this.grid / 2, 0, 2 * Math.PI, false, 0.2, false);
        }

        // unselected components
        this.unsel_bbox = this.aspect.unselected_bbox();

        var diagram = this; // for closure below
        this.aspect.map_over_components(function(c) {
            if (!c.selected) c.draw(diagram);
        });

        this.redraw(); // background changed, redraw on screen
    };

    // redraw what user sees = static image + dynamic parts
    Diagram.prototype.redraw = function() {
        var c = this.canvas.getContext('2d');
        this.c = c;

        // put static image in the background
        c.drawImage(this.bg_image, 0, 0, this.canvas.clientWidth, this.canvas.clientHeight);

        // selected components
        this.bbox = this.aspect.selected_bbox(this.unsel_bbox);
        if (this.bbox[0] == Infinity) this.bbox = [0, 0, 0, 0];

        var diagram = this; // for closure below
        this.aspect.map_over_components(function(c) {
            if (c.selected) c.draw(diagram);
        });


        var toolbar = this.editor.toolbar;
        if (toolbar) toolbar.enable_tools(this);

        // connection points: draw one at each location
        for (var location in this.aspect.connection_points) {
            var cplist = this.aspect.connection_points[location];
            cplist[0].draw(this, cplist.length);
        }

        // draw editor-specific dodads
        this.editor.redraw(this);

        // draw selection rectangle
        if (this.select_rect) {
            var t = this.select_rect;
            c.lineWidth = 1;
            c.strokeStyle = this.selected_style;
            c.beginPath();
            c.moveTo(t[0], t[1]);
            c.lineTo(t[0], t[3]);
            c.lineTo(t[2], t[3]);
            c.lineTo(t[2], t[1]);
            c.lineTo(t[0], t[1]);
            c.stroke();
        }

        // add any annotations
        for (var i = 0; i < this.annotations.length; i += 1) {
            // annotations are callbacks that get a chance to do their thing
            this.annotations[i](this);
        }

        // add scrolling/zooming control
        var r = this.sctl_r;
        var x = this.sctl_x;
        var y = this.sctl_y;

        // circle with border
        c.fillStyle = this.background_style;
        c.beginPath();
        c.arc(x, y, r, 0, 2 * Math.PI);
        c.fill();

        c.strokeStyle = this.control_style;
        c.lineWidth = 0.5;
        c.beginPath();
        c.arc(x, y, r, 0, 2 * Math.PI);
        c.stroke();

        // direction markers for scroll
        c.lineWidth = 3;
        c.beginPath();

        c.moveTo(x + 4, y - r + 8); // north
        c.lineTo(x, y - r + 4);
        c.lineTo(x - 4, y - r + 8);

        c.moveTo(x + r - 8, y + 4); // east
        c.lineTo(x + r - 4, y);
        c.lineTo(x + r - 8, y - 4);

        c.moveTo(x + 4, y + r - 8); // south
        c.lineTo(x, y + r - 4);
        c.lineTo(x - 4, y + r - 8);

        c.moveTo(x - r + 8, y + 4); // west
        c.lineTo(x - r + 4, y);
        c.lineTo(x - r + 8, y - 4);

        c.stroke();

        // zoom control
        x = this.zctl_left;
        y = this.zctl_top;
        c.lineWidth = 0.5;
        c.fillStyle = this.background_style; // background
        c.fillRect(x, y, 16, 48);
        c.strokeStyle = this.control_style; // border
        c.strokeRect(x, y, 16, 48);
        c.lineWidth = 1.0;
        c.beginPath();
        // zoom in label
        c.moveTo(x + 4, y + 8);
        c.lineTo(x + 12, y + 8);
        c.moveTo(x + 8, y + 4);
        c.lineTo(x + 8, y + 12);
        // zoom out label
        c.moveTo(x + 4, y + 24);
        c.lineTo(x + 12, y + 24);
        c.stroke();
        // surround label
        c.strokeRect(x + 4, y + 36, 8, 8);
        c.fillStyle = this.background_style;
        c.fillRect(x + 7, y + 34, 2, 10);
        c.fillRect(x + 3, y + 39, 10, 2);
    };

    Diagram.prototype.moveTo = function(x, y) {
        var xx = Math.floor((x - this.origin_x) * this.scale);
        var yy = Math.floor((y - this.origin_y) * this.scale);
        if ((this.c.lineWidth & 1) == 1) {
            // odd line width, offset to avoid fuzziness
            xx += 0.5;
            yy += 0.5;
        }
        this.c.moveTo(xx,yy);
    };

    Diagram.prototype.lineTo = function(x, y) {
        var xx = Math.floor((x - this.origin_x) * this.scale);
        var yy = Math.floor((y - this.origin_y) * this.scale);
        if ((this.c.lineWidth & 1) == 1) {
            // odd line width, offset to avoid fuzziness
            xx += 0.5;
            yy += 0.5;
        }
        this.c.lineTo(xx,yy);
    };

    Diagram.prototype.line_width = function(width) {
        // integer line widths help us avoid the horrors of antialiasing on H and V lines
        return Math.max(1,Math.floor(width * this.scale));
    };

    Diagram.prototype.draw_line = function(x1, y1, x2, y2, width) {
        var c = this.c;
        c.lineWidth = this.line_width(width);
        c.beginPath();
        this.moveTo(x1,y1);
        this.lineTo(x2,y2);
        c.stroke();
    };

    Diagram.prototype.draw_arc = function(x, y, radius, start_radians, end_radians, anticlockwise, width, filled) {
        var c = this.c;
        c.lineWidth = this.line_width(width);
        c.beginPath();
        var xx = Math.floor((x - this.origin_x) * this.scale);
        var yy = Math.floor((y - this.origin_y) * this.scale);
        if ((this.c.lineWidth & 1) == 1) {
            // odd line width, offset to avoid fuzziness => match lines
            xx += 0.5;
            yy += 0.5;
        }
        c.arc(xx, yy, radius * this.scale, start_radians, end_radians, anticlockwise);
        if (filled) c.fill();
        else c.stroke();
    };

    Diagram.prototype.draw_text = function(text, x, y, font) {
        var c = this.c;

        // scale font size appropriately
        var s = font.match(/\d+/)[0];
        s = Math.max(2, Math.round(s * this.scale));
        c.font = font.replace(/\d+/, s.toString());

        var xx = Math.floor((x - this.origin_x) * this.scale);
        var yy = Math.floor((y - this.origin_y) * this.scale);
        c.fillText(text, xx, yy);
    };

    Diagram.prototype.draw_text_important = function(text, x, y, font) {
        this.draw_text(text, x, y, font);
    };

    // convert event coordinates into
    //   mouse_x,mouse_y = coords relative to upper left of canvas
    //   aspect_x,aspect_y = coords in aspect's coordinate system
    //   cursor_x,cursor_y = aspect coords rounded to nearest grid point
    Diagram.prototype.event_coords = function(event) {
        var pos = $(this.canvas).offset();
        this.mouse_x = event.pageX - pos.left;
        this.mouse_y = event.pageY - pos.top;
        this.aspect_x = this.mouse_x / this.scale + this.origin_x;
        this.aspect_y = this.mouse_y / this.scale + this.origin_y;
        this.cursor_x = this.on_grid(this.aspect_x);
        this.cursor_y = this.on_grid(this.aspect_y);
    };

    ///////////////////////////////////////////////////////////////////////////////
    //
    //  Event handling
    //
    ////////////////////////////////////////////////////////////////////////////////

    // process keystrokes, consuming those that are meaningful to us
    Diagram.prototype.key_down = function(event) {
        var code = event.keyCode;

        // backspace or delete: delete selected components
        if (code == 8 || code == 46) {
            // delete selected components
            this.aspect.start_action();
            this.aspect.map_over_components(function(c) {
                if (c.selected) c.remove();
            });
            this.aspect.end_action();
            this.redraw_background();
        }

        // cmd/ctrl a: select all
        else if ((event.ctrlKey || event.metaKey) && code == 65) {
            this.aspect.map_over_components(function(c) {
                c.set_select(true);
            });
            this.redraw_background();
        }

        // cmd/ctrl c: copy
        else if ((event.ctrlKey || event.metaKey) && code == 67) {
            diagram_copy(this);
        }

        // cmd/ctrl v: paste
        else if ((event.ctrlKey || event.metaKey) && code == 86) {
            diagram_paste(this);
        }

        // cmd/ctrl x: cut
        else if ((event.ctrlKey || event.metaKey) && code == 88) {
            diagram_cut(this);
        }

        // cmd/ctrl y: redo
        else if ((event.ctrlKey || event.metaKey) && code == 89) {
            diagram_redo(this);
        }

        // cmd/ctrl z: undo
        else if ((event.ctrlKey || event.metaKey) && code == 90) {
            diagram_undo(this);
        }

        else return true;

        event.preventDefault();
        return false;
    };

    // handle events in pan/zoom control
    Diagram.prototype.pan_zoom = function() {
        var mx = this.mouse_x;
        var my = this.mouse_y;
        var sx = mx - this.sctl_x;
        var sy = my - this.sctl_y;
        var zx = mx - this.zctl_left;
        var zy = my - this.zctl_top;
        var delta,temp;
        
        if (sx * sx + sy * sy <= this.sctl_r * this.sctl_r) { // click in scrolling control
            // click on scrolling control, check which quadrant
            if (Math.abs(sy) > Math.abs(sx)) { // N or S
                delta = this.canvas.height / (8 * this.scale);
                if (sy > 0) delta = -delta;
                temp = this.origin_y - delta;
                if (temp > this.origin_min * this.grid && temp < this.origin_max * this.grid) this.origin_y = temp;
            }
            else { // E or W
                delta = this.canvas.width / (8 * this.scale);
                if (sx < 0) delta = -delta;
                temp = this.origin_x + delta;
                if (temp > this.origin_min * this.grid && temp < this.origin_max * this.grid) this.origin_x = temp;
            }
        }
        else if (zx >= 0 && zx < 16 && zy >= 0 && zy < 48) { // click in zoom control
            if (zy < 16) this.zoomin();
            else if (zy < 32) this.zoomout();
            else this.zoomall();
        }
        else if (sx >= -20 && sx <= -12 && sy >= -20 && sy <= -12) {   // "secret" grid toggle
            this.show_grid = !this.show_grid;
        }
        else return false;

        this.redraw_background();
        return true;
    };

    // handle the (possible) start of a selection
    Diagram.prototype.start_select = function(shiftKey) {
        // give all components a shot at processing the selection event
        var which = -1;
        var diagram = this; // for closure
        this.aspect.map_over_components(function(c, i) {
            if (c.select(diagram.aspect_x, diagram.aspect_y, shiftKey)) {
                if (c.selected) {
                    diagram.aspect.start_action();
                    diagram.drag_begin();
                    which = i; // keep track of component we found
                }
                return true;
            }
            return false;
        });

        if (!shiftKey) {
            // did we just click on a previously selected component?
            var reselect = which != -1 && this.aspect.components[which].was_previously_selected;

            // if shift key isn't pressed and we didn't click on component
            // that was already selected, unselect everyone except component
            // we just clicked on
            if (!reselect) this.unselect_all(which);

            // if there's nothing to drag, set up a selection rectangle
            if (!this.dragging) this.select_rect = [this.mouse_x, this.mouse_y,
                                                    this.mouse_x, this.mouse_y];
        }

        this.redraw_background();
    };

    // handle dragging and selection rectangle
    Diagram.prototype.mouse_move = function() {
        if (this.dragging) {
            // see how far we moved
            var dx = this.cursor_x - this.drag_x;
            var dy = this.cursor_y - this.drag_y;
            if (dx !== 0 || dy !== 0) {
                // update position for next time
                this.drag_x = this.cursor_x;
                this.drag_y = this.cursor_y;

                // give all components a shot at processing the event
                this.aspect.map_over_components(function(c) {
                    if (c.selected) c.move(dx, dy);
                });
            }
        }
        else if (this.select_rect) {
            // update moving corner of selection rectangle
            this.select_rect[2] = this.mouse_x;
            this.select_rect[3] = this.mouse_y;
        }

        // just redraw dynamic components
        this.redraw();
    };

    // handle dragging and selection rectangle
    Diagram.prototype.mouse_up = function(shiftKey) {
        // dragging
        if (this.dragging) this.drag_end();

        // selection rectangle
        if (this.select_rect) {
            var r = this.select_rect;

            // if select_rect is a point, we've already dealt with selection
            // in mouse_down handler
            if (r[0] != r[2] || r[1] != r[3]) {
                // convert to diagram coordinates
                var s = [r[0] / this.scale + this.origin_x, r[1] / this.scale + this.origin_y,
                         r[2] / this.scale + this.origin_x, r[3] / this.scale + this.origin_y];
                jade_model.canonicalize(s);

                if (!shiftKey) this.unselect_all();

                // select components that intersect selection rectangle
                this.aspect.map_over_components(function(c) {
                    c.select_rect(s, shiftKey);
                });
            }

            this.select_rect = undefined;
            this.redraw_background();
        }
    };

    Diagram.prototype.message = function(message) {
        var status = this.editor.status;

        if (status) status.text(message);
    };

    Diagram.prototype.clear_message = function(message) {
        var status = this.editor.status;

        if (status && status.text() == message) status.text('');
    };

    ///////////////////////////////////////////////////////////////////////////////
    //
    //  Dialogs and windows
    //
    ////////////////////////////////////////////////////////////////////////////////

    Diagram.prototype.dialog = function(title, content, callback) {
        // position top,left of window where mouse is.  mouse_x and mouse_y
        // are relative to the canvas, so use its offset to figure things out
        var coffset = $(this.canvas).offset();
        coffset.top += this.mouse_y;
        coffset.left += this.mouse_x;

        dialog(title, content, callback, coffset);
    };

    Diagram.prototype.window = function(title, content, offset) {
        // position top,left of window where mouse is.  mouse_x and mouse_y
        // are relative to the canvas, so use its offset to figure things out
        var coffset = $(this.canvas).offset();
        coffset.top += this.mouse_y + (offset || 0);
        coffset.left += this.mouse_x + (offset || 0);

        jade_window(title,content,coffset);
    };

    // set up a dialog with specified title, content and two buttons at
    // the bottom: OK and Cancel.  If Cancel is clicked, dialog goes away
    // and we're done.  If OK is clicked, dialog goes away and the
    // callback function is called with the content as an argument (so
    // that the values of any fields can be captured).
    function dialog(title, content, callback, offset) {
        // create the div for the top level of the dialog, add to DOM
        var dialog = $('<div>' +
                       ' <div class="jade-dialog-content"></div>' +
                       ' <div class="jade-dialog-buttons">' +
                       '  <span id="ok" class="jade-dialog-button">OK</span>' +
                       '  <span id="cancel" class="jade-dialog-button">Cancel</span></div>' +
                       '</div>');

        dialog[0].callback = callback;

        // look for property input fields in the content and give
        // them a keypress listener that interprets ENTER as
        // clicking OK.
        var focus;  // remember field to get initial focus
        $(content).find('.property').each(function (i,field) {
            var f = $(field);
            if (i == 0) focus = f;
            field.dialog = dialog[0]; // help event handler find us...

            // if user hits enter, it counts as clicking OK
            f.keypress(function (event) {
                if (event.keyCode == 13) dialog.find('#ok').trigger('click');
            });
            // select entire contents of <input> when it gets focus
            f.focus(function () {
                this.select();
            });
        });

        // fill in body element, set up click handlers
        dialog.find('.jade-dialog-content').append(content);

        dialog.find('#ok').on('click',function () {
            window_close(dialog[0].win);

            // invoke the callback with the dialog contents as the argument.
            // small delay allows browser to actually remove window beforehand
            if (dialog[0].callback) setTimeout(function() {
                dialog[0].callback();
            }, 1);
        });

        dialog.find('#cancel').on('click',function () {
            window_close(dialog[0].win);
        });

        // put into an overlay window
        jade_window(title, dialog[0], offset);

        // give initial focus to first property's <input> 
        if (focus) focus.focus();
    };

    // build a 2-column HTML table from an associative array (keys as text in
    // column 1, values in column 2).
    function build_table(a) {
        var tbl = $('<table></table>');

        // build a row for each element in associative array
        for (var i in a) {
            var row = $('<tr valign="center"><td><nobr>'+i+' :</nobr></td><td id="field"></td></tr>');
            row.find('#field').append(a[i]);
            tbl.append(row);
        }

        return tbl[0];
    }

    function build_button(label, callback) {
        var button = $('<button>'+label+'</button>').click(callback);
        return button[0];
    }

    // build an input field
    function build_input(type, size, value) {
        var input;
        if (type == 'text') {
            input = $('<textarea class="property" autocorrect="off" autocapitalize="off" rows="1"></textarea>');
        } else {
            input = $('<input class="property" autocorrect="off" autocapitalize="off"></input>').attr('type',type).attr('size',size);
        }
        input.val(value === undefined ? '' : value.toString());
        return input[0];
    }

    // build a select widget using the strings found in the options array
    function build_select(options, selected, select) {
        if (select === undefined) select = $('<select></select>');
        else select = $(select);
        for (var i = 0; i < options.length; i += 1) {
            var option = $('<option>'+options[i]+'</option>');
            select.append(option);
            if (options[i] == selected) option.attr('selected','true');
        }
        return select[0];
    }

    var window_list = [];

    function jade_window(title, content, offset) {
        // create the div for the top level of the window
        var win = $('<div class="jade-window">'+
                    ' <div class="jade-window-title">' + title + '<img style="float: right"></img></div>' +
                    '</div>');
        win[0].content = content;
        win[0].drag_x = undefined;
        win[0].draw_y = undefined;

        var head = win.find('.jade-window-title').mousedown(window_mouse_down);
        head[0].win = win[0];
        win[0].head = head[0];

        var close_button = win.find('img').click(window_close_button).attr('src',jade_icons.close_icon);
        close_button[0].win = win[0];

        win.append($(content));
        content.win = win[0]; // so content can contact us
        $(content).toggleClass('jade-window-contents');

        if (content.resize) {
            var resize = $('<img class="jade-window-resize"></img>');
            resize.attr('src',jade_icons.resize_icon);
            resize[0].win = win;
            win[0].resize = function(dx, dy) {
                // change size of window and content
                var e = win;
                e.height(e.height() + dy);
                e.width(e.width() + dx);

                // let contents know new size
                e = $(content);
                content.resize(content, e.width() + dx, e.height() + dy);
            };
            resize.mousedown(window_resize_start);
            win.append(resize);
        }

        $('body').append(win);

        // position top,left of window where mouse is.  mouse_x and mouse_y
        // are relative to the canvas, so use its offset to figure things out
        win.offset(offset);
        bring_to_front(win[0], true);
        return win;
    };

    // adjust zIndex of pop-up window so that it is in front
    function bring_to_front(win, insert) {
        var i = window_list.indexOf(win);

        // remove from current position (if any) in window list
        if (i != -1) window_list.splice(i, 1);

        // if requested, add to end of window list
        if (insert) window_list.push(win);

        // adjust all zIndex values
        for (i = 0; i < window_list.length; i += 1) {
            window_list[i].style.zIndex = 100 + i;
        }
    }

    // close the window
    function window_close(win) {
        // remove the window from the DOM
        $(win).remove();

        // remove from list of pop-up windows
        bring_to_front(win, false);
    }

    function window_close_button(event) {
        window_close(event.target.win);
    }

    // capture mouse events in title bar of window
    function window_mouse_down(event) {
        var win = event.target.win;

        bring_to_front(win, true);

        // add handlers to document so we capture them no matter what
        $(document).mousemove(window_mouse_move);
        $(document).mouseup(window_mouse_up);
        document.tracking_window = win;

        // in Chrome avoid selecting everything as we drag window
        win.saved_onselectstart = document.onselectstart;
        document.onselectstart = function() {
            return false;
        };

        // remember where mouse is so we can compute dx,dy during drag
        win.drag_x = event.pageX;
        win.drag_y = event.pageY;

        return false;
    }

    function window_mouse_up(event) {
        var win = document.tracking_window;

        // show's over folks...
        $(document).unbind('mousemove');
        $(document).unbind('mouseup');
        document.tracking_window = undefined;
        win.drag_x = undefined;
        win.drag_y = undefined;

        document.onselectstart = win.saved_onselectstart;

        return false; // consume event
    }

    function window_mouse_move(event) {
        var win = document.tracking_window;

        if (win.drag_x) {
            var dx = event.pageX - win.drag_x;
            var dy = event.pageY - win.drag_y;

            // move window by dx,dy
            var offset = $(win).offset();
            offset.top += dy;
            offset.left += dx;
            $(win).offset(offset);

            // update reference point
            win.drag_x += dx;
            win.drag_y += dy;

            return false; // consume event
        }
        return false;
    }

    function window_resize_start(event) {
        var win = event.target.win;
        var lastX = event.pageX;
        var lastY = event.pageY;

        $(document).mousemove(function(event) {
            win[0].resize(event.pageX - lastX, event.pageY - lastY);
            lastX = event.pageX;
            lastY = event.pageY;
            return false;
        });

        $(document).mouseup(function(event) {
            $(document).unbind('mousemove');
            $(document).unbind('mouseup');
            return false;
        });

        return false;
    }

    //////////////////////////////////////////////////////////////////////
    //
    // Toolbar
    //
    //////////////////////////////////////////////////////////////////////

    function Toolbar(diagram) {
        this.diagram = diagram;
        this.tools = {};
        this.toolbar = $('<div class="jade-toolbar"></div>');
    }

    Toolbar.prototype.height = function() {
        return this.toolbar.outerHeight(true);
    };

    Toolbar.prototype.add_tool = function(tname, icon, tip, handler, enable_check) {
        var tool;
        if (icon.search('data:image') != -1) {
            tool = $('<img draggable="false"></img>');
            tool.attr('src',icon);
        }
        else tool = $('<span>'+icon+'</span>');
        tool.addClass('jade-tool jade-tool-disabled');
        tool[0].enabled = false;

        // set up event processing
        tool.mouseover(tool_enter).mouseout(tool_leave).click(tool_click);

        // add to toolbar
        tool[0].diagram = this.diagram;
        tool[0].tip = tip;
        tool[0].callback = handler;
        tool[0].enable_check = enable_check;
        this.tools[tname] = tool;
        this.toolbar.append(tool);

        return tool;
    };

    Toolbar.prototype.add_spacer = function() {
        this.toolbar.append('<div class="jade-tool-spacer"></div>');
    };

    Toolbar.prototype.enable_tools = function(diagram) {
        // loop through the tools, updating their enabled status
        for (var t in this.tools) {
            var tool = this.tools[t];
            var which = tool[0].enable_check ? tool[0].enable_check(diagram) : true;
            tool[0].enabled = which;
            tool.toggleClass('jade-tool-disabled', !which);
            tool.toggleClass('jade-tool-enabled', which);
        }
    };

    // display tip when mouse is over tool
    function tool_enter(event) {
        var tool = event.target;

        if (tool.enabled) {
            tool.diagram.message(tool.tip);
        }
    }

    // clear tip when mouse leaves
    function tool_leave(event) {
        var tool = event.target;

        if (tool.enabled) {
            tool.diagram.clear_message(tool.tip);
        }
    }

    // handle click on a tool
    function tool_click(event) {
        var tool = event.target;

        if (tool.enabled) {
            tool.diagram.event_coords(event); // so we can position pop-up window correctly
            tool.callback(tool.diagram);
        }
    }

    //////////////////////////////////////////////////////////////////////
    //
    // Editor framework
    //
    //////////////////////////////////////////////////////////////////////

    var editors = []; // list of supported aspects

    var clipboards = {}; // clipboards for each editor type

    function Jade(owner,name,readonly) {
        var jade = this;
        this.parent = owner;

        // grab children and empty out div
        this.id = owner.attr('id');

        var top_level = $('<div class="jade-top-level">' +
                          ' <div class="jade-tabs-div"></div>' +
                          ' <div class="jade-status"><span id="message"></span></div>' +
                          '</div>');
        this.status = top_level.find('#message');

        // insert framework into DOM
        owner.append(top_level);

        // now add a display tab for each registered editor
        var tabs_div = top_level.find('.jade-tabs-div');
        var tabs = {};
        this.tabs = tabs;
        this.selected_tab = undefined;

        var elist;
        var editor_list = owner.attr('editors');  // did user supply list?
        if (editor_list !== undefined) {
            elist = [];
            $.each(editor_list.split(','),function(index,value) {
                $.each(editors,function(eindex,evalue) {
                    if (evalue.prototype.editor_name == value) elist.push(evalue);
                });
            });
        } else elist = editors;

        $.each(elist,function(i,editor) {
            var ename = editor.prototype.editor_name;
            clipboards[ename] = []; // initialize editor's clipboard

            // add tab selector
            var tab = $('<div class="jade-tab">'+ename+'</div>');
            tabs_div.append(tab);
            tab.click(function(event) {
                jade.show(ename);
                event.preventDefault();
            });

            // add body for each tab (only one will have display != none)
            var body = $('<div class="jade-tab-body"></div>');
            top_level.find('.jade-tabs-div').after(body);
            // make a new editor for this aspect
            body[0].editor = new editor(body[0], jade);

            tabs[ename] = [tab[0], body[0]];
        });

        // select first aspect as the one to be displayed
        if (elist.length > 0) {
            this.show(elist[0].prototype.editor_name);
        }

        // add status line at the bottom
        this.status.text('');

        jade_model.find_module(name,function(m){
            jade.module = m;
            jade.refresh();
        });
    }

    Jade.prototype.changeGeneration = function () {
        return 0;
    };

    Jade.prototype.getValue = function () {
        return JSON.stringify(this.module.json());
    };

    Jade.prototype.setValue = function (content) {
        this.module.load(content);
        this.refresh();
    };
    
    Jade.prototype.blur = function () {
    };

    Jade.prototype.focus = function () {
    };

    Jade.prototype.isClean = function(generation) {
        return this.module.modified;
    };

    Jade.prototype.on = function() {
    };

    // remember module and aspect for next visit
    Jade.prototype.bookmark = function() {
        if (this.module !== undefined) {
            var mark = this.module.get_name();
            if (this.selected_tab !== undefined) mark += '.' + this.selected_tab;
            localStorage.setItem('jade-module',mark);
        }
    };

    // if underlying library/module is reloaded, refresh each tab
    Jade.prototype.refresh = function() {
        if (this.module === undefined) return;

        // tell each tab which module we're editing
        for (var e in this.tabs) {
            this.tabs[e][1].editor.set_aspect(this.module);
        }
    };

    // make a particular tab visible -- DOM class name does the heavy lifting
    Jade.prototype.show = function(tab_name) {
        this.selected_tab = tab_name;
        this.bookmark();
        for (var tab in this.tabs) {
            var e = this.tabs[tab]; // [tab div, body div]
            var selected = (tab == tab_name);
            //e[0].className = 'jade-tab';
            $(e[0]).toggleClass('jade-tab-active', selected);
            $(e[1]).toggleClass('jade-tab-body-active', selected);
            if (selected) e[1].editor.show();
        }
    };

    Jade.prototype.resize = function(w,h) {
        if (w === 0) return;

        var e = this.parent;

        // allow for margins, border, padding of tab-pane
        w -= 2;    // border: 1
        h -= 1;    // bottom-border: 1

        e.width(w);
        e.height(h);

        // adjust size of all the tab bodies.  Account for tabs and status divs
        // .jade-tabs-div: margin-top: 4, height: 16
        // .jade-status: padding-top: 5, height: 14
        h -=  39;
        var ediv,ew,eh;
        for (var tab in this.tabs) {
            ediv = this.tabs[tab][1]; // [tab div, body div]
            e = $(ediv);
            // .jade-tab-body: border: 1, padding: 5, margin-top: 2
            ew = w - 12;
            eh = h - 14;
            e.width(ew);
            e.height(eh);
            // inform associated editor about its new size
            ediv.editor.resize(ew, eh, tab == this.selected_tab);
        }
    };

    // exports
    return {
        Diagram: Diagram,
        diagram_undo: diagram_undo,
        diagram_redo: diagram_redo,
        diagram_cut: diagram_cut,
        diagram_copy: diagram_copy,
        diagram_paste: diagram_paste,
        diagram_fliph: diagram_fliph,
        diagram_flipv: diagram_flipv,
        diagram_rotcw: diagram_rotcw,
        diagram_rotccw: diagram_rotccw,
        Toolbar: Toolbar,
        Jade: Jade,
        editors: editors,
        clipboards: clipboards,
        build_table: build_table,
        build_button: build_button,
        build_input: build_input,
        build_select: build_select,
        dialog: dialog,
        window: jade_window,
        window_close: window_close
    };
}());