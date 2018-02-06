"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var channel_1 = require("../../channel");
var fielddef_1 = require("../../fielddef");
var legend_1 = require("../../legend");
var type_1 = require("../../type");
var util_1 = require("../../util");
var common_1 = require("../common");
var model_1 = require("../model");
var resolve_1 = require("../resolve");
var split_1 = require("../split");
var split_2 = require("../split");
var component_1 = require("./component");
var encode = require("./encode");
var properties = require("./properties");
function parseLegend(model) {
    if (model_1.isUnitModel(model)) {
        model.component.legends = parseUnitLegend(model);
    }
    else {
        model.component.legends = parseNonUnitLegend(model);
    }
}
exports.parseLegend = parseLegend;
function parseUnitLegend(model) {
    var encoding = model.encoding;
    return [channel_1.COLOR, channel_1.SIZE, channel_1.SHAPE, channel_1.OPACITY].reduce(function (legendComponent, channel) {
        var def = encoding[channel];
        if (model.legend(channel) && model.getScaleComponent(channel) && !(fielddef_1.isFieldDef(def) && (channel === channel_1.SHAPE && def.type === type_1.GEOJSON))) {
            legendComponent[channel] = parseLegendForChannel(model, channel);
        }
        return legendComponent;
    }, {});
}
function getLegendDefWithScale(model, channel) {
    // For binned field with continuous scale, use a special scale so we can overrride the mark props and labels
    switch (channel) {
        case channel_1.COLOR:
            var scale = model.scaleName(channel_1.COLOR);
            return model.markDef.filled ? { fill: scale } : { stroke: scale };
        case channel_1.SIZE:
            return { size: model.scaleName(channel_1.SIZE) };
        case channel_1.SHAPE:
            return { shape: model.scaleName(channel_1.SHAPE) };
        case channel_1.OPACITY:
            return { opacity: model.scaleName(channel_1.OPACITY) };
    }
    return null;
}
function parseLegendForChannel(model, channel) {
    var fieldDef = model.fieldDef(channel);
    var legend = model.legend(channel);
    var legendCmpt = new component_1.LegendComponent({}, getLegendDefWithScale(model, channel));
    legend_1.LEGEND_PROPERTIES.forEach(function (property) {
        var value = getProperty(property, legend, channel, model);
        if (value !== undefined) {
            var explicit = property === 'values' ?
                !!legend.values : // specified legend.values is already respected, but may get transformed.
                value === legend[property];
            if (explicit || model.config.legend[property] === undefined) {
                legendCmpt.set(property, value, explicit);
            }
        }
    });
    // 2) Add mark property definition groups
    var legendEncoding = legend.encoding || {};
    var legendEncode = ['labels', 'legend', 'title', 'symbols', 'gradient'].reduce(function (e, part) {
        var value = encode[part] ?
            // TODO: replace legendCmpt with type is sufficient
            encode[part](fieldDef, legendEncoding[part], model, channel, legendCmpt.get('type')) : // apply rule
            legendEncoding[part]; // no rule -- just default values
        if (value !== undefined && util_1.keys(value).length > 0) {
            e[part] = { update: value };
        }
        return e;
    }, {});
    if (util_1.keys(legendEncode).length > 0) {
        legendCmpt.set('encode', legendEncode, !!legend.encoding);
    }
    return legendCmpt;
}
exports.parseLegendForChannel = parseLegendForChannel;
function getProperty(property, specifiedLegend, channel, model) {
    var fieldDef = model.fieldDef(channel);
    switch (property) {
        case 'format':
            // We don't include temporal field here as we apply format in encode block
            return common_1.numberFormat(fieldDef, specifiedLegend.format, model.config);
        case 'title':
            return common_1.getSpecifiedOrDefaultValue(specifiedLegend.title, fielddef_1.title(fieldDef, model.config));
        case 'values':
            return properties.values(specifiedLegend);
        case 'type':
            return common_1.getSpecifiedOrDefaultValue(specifiedLegend.type, properties.type(fieldDef.type, channel, model.getScaleComponent(channel).get('type')));
    }
    // Otherwise, return specified property.
    return specifiedLegend[property];
}
function parseNonUnitLegend(model) {
    var _a = model.component, legends = _a.legends, resolve = _a.resolve;
    var _loop_1 = function (child) {
        parseLegend(child);
        util_1.keys(child.component.legends).forEach(function (channel) {
            resolve.legend[channel] = resolve_1.parseGuideResolve(model.component.resolve, channel);
            if (resolve.legend[channel] === 'shared') {
                // If the resolve says shared (and has not been overridden)
                // We will try to merge and see if there is a conflict
                legends[channel] = mergeLegendComponent(legends[channel], child.component.legends[channel]);
                if (!legends[channel]) {
                    // If merge returns nothing, there is a conflict so we cannot make the legend shared.
                    // Thus, mark legend as independent and remove the legend component.
                    resolve.legend[channel] = 'independent';
                    delete legends[channel];
                }
            }
        });
    };
    for (var _i = 0, _b = model.children; _i < _b.length; _i++) {
        var child = _b[_i];
        _loop_1(child);
    }
    util_1.keys(legends).forEach(function (channel) {
        for (var _i = 0, _a = model.children; _i < _a.length; _i++) {
            var child = _a[_i];
            if (!child.component.legends[channel]) {
                // skip if the child does not have a particular legend
                continue;
            }
            if (resolve.legend[channel] === 'shared') {
                // After merging shared legend, make sure to remove legend from child
                delete child.component.legends[channel];
            }
        }
    });
    return legends;
}
function mergeLegendComponent(mergedLegend, childLegend) {
    if (!mergedLegend) {
        return childLegend.clone();
    }
    var mergedOrient = mergedLegend.getWithExplicit('orient');
    var childOrient = childLegend.getWithExplicit('orient');
    if (mergedOrient.explicit && childOrient.explicit && mergedOrient.value !== childOrient.value) {
        // TODO: throw warning if resolve is explicit (We don't have info about explicit/implicit resolve yet.)
        // Cannot merge due to inconsistent orient
        return undefined;
    }
    var typeMerged = false;
    var _loop_2 = function (prop) {
        var mergedValueWithExplicit = split_2.mergeValuesWithExplicit(mergedLegend.getWithExplicit(prop), childLegend.getWithExplicit(prop), prop, 'legend', 
        // Tie breaker function
        function (v1, v2) {
            switch (prop) {
                case 'title':
                    return common_1.titleMerger(v1, v2);
                case 'type':
                    // There are only two types. If we have different types, then prefer symbol over gradient.
                    typeMerged = true;
                    return split_1.makeImplicit('symbol');
            }
            return split_2.defaultTieBreaker(v1, v2, prop, 'legend');
        });
        mergedLegend.setWithExplicit(prop, mergedValueWithExplicit);
    };
    // Otherwise, let's merge
    for (var _i = 0, VG_LEGEND_PROPERTIES_1 = legend_1.VG_LEGEND_PROPERTIES; _i < VG_LEGEND_PROPERTIES_1.length; _i++) {
        var prop = VG_LEGEND_PROPERTIES_1[_i];
        _loop_2(prop);
    }
    if (typeMerged) {
        if (((mergedLegend.implicit || {}).encode || {}).gradient) {
            util_1.deleteNestedProperty(mergedLegend.implicit, ['encode', 'gradient']);
        }
        if (((mergedLegend.explicit || {}).encode || {}).gradient) {
            util_1.deleteNestedProperty(mergedLegend.explicit, ['encode', 'gradient']);
        }
    }
    return mergedLegend;
}
exports.mergeLegendComponent = mergeLegendComponent;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicGFyc2UuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvY29tcGlsZS9sZWdlbmQvcGFyc2UudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7QUFBQSx5Q0FBNEY7QUFDNUYsMkNBQWtFO0FBQ2xFLHVDQUE2RTtBQUM3RSxtQ0FBbUM7QUFDbkMsbUNBQXNEO0FBRXRELG9DQUFnRjtBQUNoRixrQ0FBNEM7QUFDNUMsc0NBQTZDO0FBQzdDLGtDQUFnRDtBQUNoRCxrQ0FBb0U7QUFFcEUseUNBQWtFO0FBQ2xFLGlDQUFtQztBQUNuQyx5Q0FBMkM7QUFHM0MscUJBQTRCLEtBQVk7SUFDdEMsRUFBRSxDQUFDLENBQUMsbUJBQVcsQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUM7UUFDdkIsS0FBSyxDQUFDLFNBQVMsQ0FBQyxPQUFPLEdBQUcsZUFBZSxDQUFDLEtBQUssQ0FBQyxDQUFDO0lBQ25ELENBQUM7SUFBQyxJQUFJLENBQUMsQ0FBQztRQUNOLEtBQUssQ0FBQyxTQUFTLENBQUMsT0FBTyxHQUFHLGtCQUFrQixDQUFDLEtBQUssQ0FBQyxDQUFDO0lBQ3RELENBQUM7QUFDSCxDQUFDO0FBTkQsa0NBTUM7QUFFRCx5QkFBeUIsS0FBZ0I7SUFDaEMsSUFBQSx5QkFBUSxDQUFVO0lBQ3pCLE1BQU0sQ0FBQyxDQUFDLGVBQUssRUFBRSxjQUFJLEVBQUUsZUFBSyxFQUFFLGlCQUFPLENBQUMsQ0FBQyxNQUFNLENBQUMsVUFBVSxlQUFlLEVBQUUsT0FBTztRQUM1RSxJQUFNLEdBQUcsR0FBRyxRQUFRLENBQUMsT0FBTyxDQUFDLENBQUM7UUFDOUIsRUFBRSxDQUFDLENBQUMsS0FBSyxDQUFDLE1BQU0sQ0FBQyxPQUFPLENBQUMsSUFBSSxLQUFLLENBQUMsaUJBQWlCLENBQUMsT0FBTyxDQUFDLElBQUksQ0FBQyxDQUFDLHFCQUFVLENBQUMsR0FBRyxDQUFDLElBQUksQ0FBQyxPQUFPLEtBQUssZUFBSyxJQUFJLEdBQUcsQ0FB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QUN6QixHQUFHLENBQUMsQ0FBZSxVQUFvQixFQUFwQix5QkFBQSw2QkFBb0IsRUFBcEIsa0NBQW9CLEVBQXBCLElBQW9CO1FBQWxDLElBQU0sSUFBSSw2QkFBQTtnQkFBSixJQUFJO0tBb0JkO0lBQ0QsRUFBRSxDQUFDLENBQUMsVUFBVSxDQUFDLENBQUMsQ0FBQztRQUNmLEVBQUUsQ0FBQSxDQUFDLENBQUMsQ0FBQyxZQUFZLENBQUMsUUFBUSxJQUFJLEVBQUUsQ0FBQyxDQUFDLE1BQU0sSUFBSSxFQUFFLENBQUMsQ0FBQyxRQUFRLENBQUMsQ0FBQyxDQUFDO1lBQ3pELDJCQUFvQixDQUFDLFlBQVksQ0FBQyxRQUFRLEVBQUUsQ0FBQyxRQUFRLEVBQUUsVUFBVSxDQUFDLENBQUMsQ0FBQztRQUN0RSxDQUFDO1FBQ0QsRUFBRSxDQUFDLENBQUMsQ0FBQyxDQUFDLFlBQVksQ0FBQyxRQUFRLElBQUksRUFBRSxDQUFDLENBQUMsTUFBTSxJQUFJLEVBQUUsQ0FBQyxDQUFDLFFBQVEsQ0FBQyxDQUFDLENBQUM7WUFDMUQsMkJBQW9CLENBQUMsWUFBWSxDQUFDLFFBQVEsRUFBRSxDQUFDLFFBQVEsRUFBRSxVQUFVLENBQUMsQ0FBQyxDQUFDO1FBQ3RFLENBQUM7SUFDSCxDQUFDO0lBR0QsTUFBTSxDQUFDLFlBQVksQ0FBQztBQUN0QixDQUFDO0FBL0NELG9EQStDQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7Q2hhbm5lbCwgQ09MT1IsIE5vblBvc2l0aW9uU2NhbGVDaGFubmVsLCBPUEFDSVRZLCBTSEFQRSwgU0laRX0gZnJvbSAnLi4vLi4vY2hhbm5lbCc7XG5pbXBvcnQge2lzRmllbGREZWYsIHRpdGxlIGFzIGZpZWxkRGVmVGl0bGV9IGZyb20gJy4uLy4uL2ZpZWxkZGVmJztcbmltcG9ydCB7TGVnZW5kLCBMRUdFTkRfUFJPUEVSVElFUywgVkdfTEVHRU5EX1BST1BFUlRJRVN9IGZyb20gJy4uLy4uL2xlZ2VuZCc7XG5pbXBvcnQge0dFT0pTT059IGZyb20gJy4uLy4uL3R5cGUnO1xuaW1wb3J0IHtkZWxldGVOZXN0ZWRQcm9wZXJ0eSwga2V5c30gZnJvbSAnLi4vLi4vdXRpbCc7XG5pbXBvcnQge1ZnTGVnZW5kLCBWZ0xlZ2VuZEVuY29kZX0gZnJvbSAnLi4vLi4vdmVnYS5zY2hlbWEnO1xuaW1wb3J0IHtnZXRTcGVjaWZpZWRPckRlZmF1bHRWYWx1ZSwgbnVtYmVyRm9ybWF0LCB0aXRsZU1lcmdlcn0gZnJvbSAnLi4vY29tbW9uJztcbmltcG9ydCB7aXNVbml0TW9kZWwsIE1vZGVsfSBmcm9tICcuLi9tb2RlbCc7XG5pbXBvcnQge3BhcnNlR3VpZGVSZXNvbHZlfSBmcm9tICcuLi9yZXNvbHZlJztcbmltcG9ydCB7RXhwbGljaXQsIG1ha2VJbXBsaWNpdH0gZnJvbSAnLi4vc3BsaXQnO1xuaW1wb3J0IHtkZWZhdWx0VGllQnJlYWtlciwgbWVyZ2VWYWx1ZXNXaXRoRXhwbGljaXR9IGZyb20gJy4uL3NwbGl0JztcbmltcG9ydCB7VW5pdE1vZGVsfSBmcm9tICcuLi91bml0JztcbmltcG9ydCB7TGVnZW5kQ29tcG9uZW50LCBMZWdlbmRDb21wb25lbnRJbmRleH0gZnJvbSAnLi9jb21wb25lbnQnO1xuaW1wb3J0ICogYXMgZW5jb2RlIGZyb20gJy4vZW5jb2RlJztcbmltcG9ydCAqIGFzIHByb3BlcnRpZXMgZnJvbSAnLi9wcm9wZXJ0aWVzJztcblxuXG5leHBvcnQgZnVuY3Rpb24gcGFyc2VMZWdlbmQobW9kZWw6IE1vZGVsKSB7XG4gIGlmIChpc1VuaXRNb2RlbChtb2RlbCkpIHtcbiAgICBtb2RlbC5jb21wb25lbnQubGVnZW5kcyA9IHBhcnNlVW5pdExlZ2VuZChtb2RlbCk7XG4gIH0gZWxzZSB7XG4gICAgbW9kZWwuY29tcG9uZW50LmxlZ2VuZHMgPSBwYXJzZU5vblVuaXRMZWdlbmQobW9kZWwpO1xuICB9XG59XG5cbmZ1bmN0aW9uIHBhcnNlVW5pdExlZ2VuZChtb2RlbDogVW5pdE1vZGVsKTogTGVnZW5kQ29tcG9uZW50SW5kZXgge1xuICBjb25zdCB7ZW5jb2Rpbmd9ID0gbW9kZWw7XG4gIHJldHVybiBbQ09MT1IsIFNJWkUsIFNIQVBFLCBPUEFDSVRZXS5yZWR1Y2UoZnVuY3Rpb24gKGxlZ2VuZENvbXBvbmVudCwgY2hhbm5lbCkge1xuICAgIGNvbnN0IGRlZiA9IGVuY29kaW5nW2NoYW5uZWxdO1xuICAgIGlmIChtb2RlbC5sZWdlbmQoY2hhbm5lbCkgJiYgbW9kZWwuZ2V0U2NhbGVDb21wb25lbnQoY2hhbm5lbCkgJiYgIShpc0ZpZWxkRGVmKGRlZikgJiYgKGNoYW5uZWwgPT09IFNIQVBFICYmIGRlZi50eXBlID09PSBHRU9KU09OKSkpIHtcbiAgICAgIGxlZ2VuZENvbXBvbmVudFtjaGFubmVsXSA9IHBhcnNlTGVnZW5kRm9yQ2hhbm5lbChtb2RlbCwgY2hhbm5lbCk7XG4gICAgfVxuICAgIHJldHVybiBsZWdlbmRDb21wb25lbnQ7XG4gIH0sIHt9KTtcbn1cblxuZnVuY3Rpb24gZ2V0TGVnZW5kRGVmV2l0aFNjYWxlKG1vZGVsOiBVbml0TW9kZWwsIGNoYW5uZWw6IENoYW5uZWwpOiBWZ0xlZ2VuZCB7XG4gIC8vIEZvciBiaW5uZWQgZmllbGQgd2l0aCBjb250aW51b3VzIHNjYWxlLCB1c2UgYSBzcGVjaWFsIHNjYWxlIHNvIHdlIGNhbiBvdmVycnJpZGUgdGhlIG1hcmsgcHJvcHMgYW5kIGxhYmVsc1xuICBzd2l0Y2ggKGNoYW5uZWwpIHtcbiAgICBjYXNlIENPTE9SOlxuICAgICAgY29uc3Qgc2NhbGUgPSBtb2RlbC5zY2FsZU5hbWUoQ09MT1IpO1xuICAgICAgcmV0dXJuIG1vZGVsLm1hcmtEZWYuZmlsbGVkID8ge2ZpbGw6IHNjYWxlfSA6IHtzdHJva2U6IHNjYWxlfTtcbiAgICBjYXNlIFNJWkU6XG4gICAgICByZXR1cm4ge3NpemU6IG1vZGVsLnNjYWxlTmFtZShTSVpFKX07XG4gICAgY2FzZSBTSEFQRTpcbiAgICAgIHJldHVybiB7c2hhcGU6IG1vZGVsLnNjYWxlTmFtZShTSEFQRSl9O1xuICAgIGNhc2UgT1BBQ0lUWTpcbiAgICAgIHJldHVybiB7b3BhY2l0eTogbW9kZWwuc2NhbGVOYW1lKE9QQUNJVFkpfTtcbiAgfVxuICByZXR1cm4gbnVsbDtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlTGVnZW5kRm9yQ2hhbm5lbChtb2RlbDogVW5pdE1vZGVsLCBjaGFubmVsOiBOb25Qb3NpdGlvblNjYWxlQ2hhbm5lbCk6IExlZ2VuZENvbXBvbmVudCB7XG4gIGNvbnN0IGZpZWxkRGVmID0gbW9kZWwuZmllbGREZWYoY2hhbm5lbCk7XG4gIGNvbnN0IGxlZ2VuZCA9IG1vZGVsLmxlZ2VuZChjaGFubmVsKTtcblxuICBjb25zdCBsZWdlbmRDbXB0ID0gbmV3IExlZ2VuZENvbXBvbmVudCh7fSwgZ2V0TGVnZW5kRGVmV2l0aFNjYWxlKG1vZGVsLCBjaGFubmVsKSk7XG5cbiAgTEVHRU5EX1BST1BFUlRJRVMuZm9yRWFjaChmdW5jdGlvbihwcm9wZXJ0eSkge1xuICAgIGNvbnN0IHZhbHVlID0gZ2V0UHJvcGVydHkocHJvcGVydHksIGxlZ2VuZCwgY2hhbm5lbCwgbW9kZWwpO1xuICAgIGlmICh2YWx1ZSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICBjb25zdCBleHBsaWNpdCA9IHByb3BlcnR5ID09PSAndmFsdWVzJyA/XG4gICAgICAgICEhbGVnZW5kLnZhbHVlcyA6ICAvLyBzcGVjaWZpZWQgbGVnZW5kLnZhbHVlcyBpcyBhbHJlYWR5IHJlc3BlY3RlZCwgYnV0IG1heSBnZXQgdHJhbnNmb3JtZWQuXG4gICAgICAgIHZhbHVlID09PSBsZWdlbmRbcHJvcGVydHldO1xuICAgICAgaWYgKGV4cGxpY2l0IHx8IG1vZGVsLmNvbmZpZy5sZWdlbmRbcHJvcGVydHldID09PSB1bmRlZmluZWQpIHtcbiAgICAgICAgbGVnZW5kQ21wdC5zZXQocHJvcGVydHksIHZhbHVlLCBleHBsaWNpdCk7XG4gICAgICB9XG4gICAgfVxuICB9KTtcblxuICAvLyAyKSBBZGQgbWFyayBwcm9wZXJ0eSBkZWZpbml0aW9uIGdyb3Vwc1xuICBjb25zdCBsZWdlbmRFbmNvZGluZyA9IGxlZ2VuZC5lbmNvZGluZyB8fCB7fTtcbiAgY29uc3QgbGVnZW5kRW5jb2RlID0gWydsYWJlbHMnLCAnbGVnZW5kJywgJ3RpdGxlJywgJ3N5bWJvbHMnLCAnZ3JhZGllbnQnXS5yZWR1Y2UoKGU6IFZnTGVnZW5kRW5jb2RlLCBwYXJ0KSA9PiB7XG4gICAgY29uc3QgdmFsdWUgPSBlbmNvZGVbcGFydF0gP1xuICAgICAgLy8gVE9ETzogcmVwbGFjZSBsZWdlbmRDbXB0IHdpdGggdHlwZSBpcyBzdWZmaWNpZW50XG4gICAgICBlbmNvZGVbcGFydF0oZmllbGREZWYsIGxlZ2VuZEVuY29kaW5nW3BhcnRdLCBtb2RlbCwgY2hhbm5lbCwgbGVnZW5kQ21wdC5nZXQoJ3R5cGUnKSkgOiAvLyBhcHBseSBydWxlXG4gICAgICBsZWdlbmRFbmNvZGluZ1twYXJ0XTsgLy8gbm8gcnVsZSAtLSBqdXN0IGRlZmF1bHQgdmFsdWVzXG4gICAgaWYgKHZhbHVlICE9PSB1bmRlZmluZWQgJiYga2V5cyh2YWx1ZSkubGVuZ3RoID4gMCkge1xuICAgICAgZVtwYXJ0XSA9IHt1cGRhdGU6IHZhbHVlfTtcbiAgICB9XG4gICAgcmV0dXJuIGU7XG4gIH0sIHt9IGFzIFZnTGVnZW5kRW5jb2RlKTtcblxuICBpZiAoa2V5cyhsZWdlbmRFbmNvZGUpLmxlbmd0aCA+IDApIHtcbiAgICBsZWdlbmRDbXB0LnNldCgnZW5jb2RlJywgbGVnZW5kRW5jb2RlLCAhIWxlZ2VuZC5lbmNvZGluZyk7XG4gIH1cblxuICByZXR1cm4gbGVnZW5kQ21wdDtcbn1cblxuZnVuY3Rpb24gZ2V0UHJvcGVydHkocHJvcGVydHk6IGtleW9mIChMZWdlbmQgfCBWZ0xlZ2VuZCksIHNwZWNpZmllZExlZ2VuZDogTGVnZW5kLCBjaGFubmVsOiBOb25Qb3NpdGlvblNjYWxlQ2hhbm5lbCwgbW9kZWw6IFVuaXRNb2RlbCkge1xuICBjb25zdCBmaWVsZERlZiA9IG1vZGVsLmZpZWxkRGVmKGNoYW5uZWwpO1xuXG4gIHN3aXRjaCAocHJvcGVydHkpIHtcbiAgICBjYXNlICdmb3JtYXQnOlxuICAgICAgLy8gV2UgZG9uJ3QgaW5jbHVkZSB0ZW1wb3JhbCBmaWVsZCBoZXJlIGFzIHdlIGFwcGx5IGZvcm1hdCBpbiBlbmNvZGUgYmxvY2tcbiAgICAgIHJldHVybiBudW1iZXJGb3JtYXQoZmllbGREZWYsIHNwZWNpZmllZExlZ2VuZC5mb3JtYXQsIG1vZGVsLmNvbmZpZyk7XG4gICAgY2FzZSAndGl0bGUnOlxuICAgICAgcmV0dXJuIGdldFNwZWNpZmllZE9yRGVmYXVsdFZhbHVlKHNwZWNpZmllZExlZ2VuZC50aXRsZSwgZmllbGREZWZUaXRsZShmaWVsZERlZiwgbW9kZWwuY29uZmlnKSk7XG4gICAgY2FzZSAndmFsdWVzJzpcbiAgICAgIHJldHVybiBwcm9wZXJ0aWVzLnZhbHVlcyhzcGVjaWZpZWRMZWdlbmQpO1xuICAgIGNhc2UgJ3R5cGUnOlxuICAgICAgcmV0dXJuIGdldFNwZWNpZmllZE9yRGVmYXVsdFZhbHVlKHNwZWNpZmllZExlZ2VuZC50eXBlLCBwcm9wZXJ0aWVzLnR5cGUoZmllbGREZWYudHlwZSwgY2hhbm5lbCwgbW9kZWwuZ2V0U2NhbGVDb21wb25lbnQoY2hhbm5lbCkuZ2V0KCd0eXBlJykpKTtcbiAgfVxuXG4gIC8vIE90aGVyd2lzZSwgcmV0dXJuIHNwZWNpZmllZCBwcm9wZXJ0eS5cbiAgcmV0dXJuIHNwZWNpZmllZExlZ2VuZFtwcm9wZXJ0eV07XG59XG5cbmZ1bmN0aW9uIHBhcnNlTm9uVW5pdExlZ2VuZChtb2RlbDogTW9kZWwpIHtcbiAgY29uc3Qge2xlZ2VuZHMsIHJlc29sdmV9ID0gbW9kZWwuY29tcG9uZW50O1xuXG4gIGZvciAoY29uc3QgY2hpbGQgb2YgbW9kZWwuY2hpbGRyZW4pIHtcbiAgICBwYXJzZUxlZ2VuZChjaGlsZCk7XG5cbiAgICBrZXlzKGNoaWxkLmNvbXBvbmVudC5sZWdlbmRzKS5mb3JFYWNoKChjaGFubmVsOiBOb25Qb3NpdGlvblNjYWxlQ2hhbm5lbCkgPT4ge1xuICAgICAgcmVzb2x2ZS5sZWdlbmRbY2hhbm5lbF0gPSBwYXJzZUd1aWRlUmVzb2x2ZShtb2RlbC5jb21wb25lbnQucmVzb2x2ZSwgY2hhbm5lbCk7XG5cbiAgICAgIGlmIChyZXNvbHZlLmxlZ2VuZFtjaGFubmVsXSA9PT0gJ3NoYXJlZCcpIHtcbiAgICAgICAgLy8gSWYgdGhlIHJlc29sdmUgc2F5cyBzaGFyZWQgKGFuZCBoYXMgbm90IGJlZW4gb3ZlcnJpZGRlbilcbiAgICAgICAgLy8gV2Ugd2lsbCB0cnkgdG8gbWVyZ2UgYW5kIHNlZSBpZiB0aGVyZSBpcyBhIGNvbmZsaWN0XG5cbiAgICAgICAgbGVnZW5kc1tjaGFubmVsXSA9IG1lcmdlTGVnZW5kQ29tcG9uZW50KGxlZ2VuZHNbY2hhbm5lbF0sIGNoaWxkLmNvbXBvbmVudC5sZWdlbmRzW2NoYW5uZWxdKTtcblxuICAgICAgICBpZiAoIWxlZ2VuZHNbY2hhbm5lbF0pIHtcbiAgICAgICAgICAvLyBJZiBtZXJnZSByZXR1cm5zIG5vdGhpbmcsIHRoZXJlIGlzIGEgY29uZmxpY3Qgc28gd2UgY2Fubm90IG1ha2UgdGhlIGxlZ2VuZCBzaGFyZWQuXG4gICAgICAgICAgLy8gVGh1cywgbWFyayBsZWdlbmQgYXMgaW5kZXBlbmRlbnQgYW5kIHJlbW92ZSB0aGUgbGVnZW5kIGNvbXBvbmVudC5cbiAgICAgICAgICByZXNvbHZlLmxlZ2VuZFtjaGFubmVsXSA9ICdpbmRlcGVuZGVudCc7XG4gICAgICAgICAgZGVsZXRlIGxlZ2VuZHNbY2hhbm5lbF07XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9KTtcbiAgfVxuXG4gIGtleXMobGVnZW5kcykuZm9yRWFjaCgoY2hhbm5lbDogTm9uUG9zaXRpb25TY2FsZUNoYW5uZWwpID0+IHtcbiAgICBmb3IgKGNvbnN0IGNoaWxkIG9mIG1vZGVsLmNoaWxkcmVuKSB7XG4gICAgICBpZiAoIWNoaWxkLmNvbXBvbmVudC5sZWdlbmRzW2NoYW5uZWxdKSB7XG4gICAgICAgIC8vIHNraXAgaWYgdGhlIGNoaWxkIGRvZXMgbm90IGhhdmUgYSBwYXJ0aWN1bGFyIGxlZ2VuZFxuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cblxuICAgICAgaWYgKHJlc29sdmUubGVnZW5kW2NoYW5uZWxdID09PSAnc2hhcmVkJykge1xuICAgICAgICAvLyBBZnRlciBtZXJnaW5nIHNoYXJlZCBsZWdlbmQsIG1ha2Ugc3VyZSB0byByZW1vdmUgbGVnZW5kIGZyb20gY2hpbGRcbiAgICAgICAgZGVsZXRlIGNoaWxkLmNvbXBvbmVudC5sZWdlbmRzW2NoYW5uZWxdO1xuICAgICAgfVxuICAgIH1cbiAgfSk7XG4gIHJldHVybiBsZWdlbmRzO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gbWVyZ2VMZWdlbmRDb21wb25lbnQobWVyZ2VkTGVnZW5kOiBMZWdlbmRDb21wb25lbnQsIGNoaWxkTGVnZW5kOiBMZWdlbmRDb21wb25lbnQpOiBMZWdlbmRDb21wb25lbnQge1xuICBpZiAoIW1lcmdlZExlZ2VuZCkge1xuICAgIHJldHVybiBjaGlsZExlZ2VuZC5jbG9uZSgpO1xuICB9XG4gIGNvbnN0IG1lcmdlZE9yaWVudCA9IG1lcmdlZExlZ2VuZC5nZXRXaXRoRXhwbGljaXQoJ29yaWVudCcpO1xuICBjb25zdCBjaGlsZE9yaWVudCA9IGNoaWxkTGVnZW5kLmdldFdpdGhFeHBsaWNpdCgnb3JpZW50Jyk7XG5cblxuICBpZiAobWVyZ2VkT3JpZW50LmV4cGxpY2l0ICYmIGNoaWxkT3JpZW50LmV4cGxpY2l0ICYmIG1lcmdlZE9yaWVudC52YWx1ZSAhPT0gY2hpbGRPcmllbnQudmFsdWUpIHtcbiAgICAvLyBUT0RPOiB0aHJvdyB3YXJuaW5nIGlmIHJlc29sdmUgaXMgZXhwbGljaXQgKFdlIGRvbid0IGhhdmUgaW5mbyBhYm91dCBleHBsaWNpdC9pbXBsaWNpdCByZXNvbHZlIHlldC4pXG4gICAgLy8gQ2Fubm90IG1lcmdlIGR1ZSB0byBpbmNvbnNpc3RlbnQgb3JpZW50XG4gICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgfVxuICBsZXQgdHlwZU1lcmdlZCA9IGZhbHNlO1xuICAvLyBPdGhlcndpc2UsIGxldCdzIG1lcmdlXG4gIGZvciAoY29uc3QgcHJvcCBvZiBWR19MRUdFTkRfUFJPUEVSVElFUykge1xuICAgIGNvbnN0IG1lcmdlZFZhbHVlV2l0aEV4cGxpY2l0ID0gbWVyZ2VWYWx1ZXNXaXRoRXhwbGljaXQ8VmdMZWdlbmQsIGFueT4oXG4gICAgICBtZXJnZWRMZWdlbmQuZ2V0V2l0aEV4cGxpY2l0KHByb3ApLFxuICAgICAgY2hpbGRMZWdlbmQuZ2V0V2l0aEV4cGxpY2l0KHByb3ApLFxuICAgICAgcHJvcCwgJ2xlZ2VuZCcsXG5cbiAgICAgIC8vIFRpZSBicmVha2VyIGZ1bmN0aW9uXG4gICAgICAodjE6IEV4cGxpY2l0PGFueT4sIHYyOiBFeHBsaWNpdDxhbnk+KTogYW55ID0+IHtcbiAgICAgICAgc3dpdGNoIChwcm9wKSB7XG4gICAgICAgICAgY2FzZSAndGl0bGUnOlxuICAgICAgICAgICAgcmV0dXJuIHRpdGxlTWVyZ2VyKHYxLCB2Mik7XG4gICAgICAgICAgY2FzZSAndHlwZSc6XG4gICAgICAgICAgICAvLyBUaGVyZSBhcmUgb25seSB0d28gdHlwZXMuIElmIHdlIGhhdmUgZGlmZmVyZW50IHR5cGVzLCB0aGVuIHByZWZlciBzeW1ib2wgb3ZlciBncmFkaWVudC5cbiAgICAgICAgICAgIHR5cGVNZXJnZWQgPSB0cnVlO1xuICAgICAgICAgICAgcmV0dXJuIG1ha2VJbXBsaWNpdCgnc3ltYm9sJyk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIGRlZmF1bHRUaWVCcmVha2VyPFZnTGVnZW5kLCBhbnk+KHYxLCB2MiwgcHJvcCwgJ2xlZ2VuZCcpO1xuICAgICAgfVxuICAgICk7XG4gICAgbWVyZ2VkTGVnZW5kLnNldFdpdGhFeHBsaWNpdChwcm9wLCBtZXJnZWRWYWx1ZVdpdGhFeHBsaWNpdCk7XG4gIH1cbiAgaWYgKHR5cGVNZXJnZWQpIHtcbiAgICBpZigoKG1lcmdlZExlZ2VuZC5pbXBsaWNpdCB8fCB7fSkuZW5jb2RlIHx8IHt9KS5ncmFkaWVudCkge1xuICAgICAgZGVsZXRlTmVzdGVkUHJvcGVydHkobWVyZ2VkTGVnZW5kLmltcGxpY2l0LCBbJ2VuY29kZScsICdncmFkaWVudCddKTtcbiAgICB9XG4gICAgaWYgKCgobWVyZ2VkTGVnZW5kLmV4cGxpY2l0IHx8IHt9KS5lbmNvZGUgfHwge30pLmdyYWRpZW50KSB7XG4gICAgICBkZWxldGVOZXN0ZWRQcm9wZXJ0eShtZXJnZWRMZWdlbmQuZXhwbGljaXQsIFsnZW5jb2RlJywgJ2dyYWRpZW50J10pO1xuICAgIH1cbiAgfVxuXG5cbiAgcmV0dXJuIG1lcmdlZExlZ2VuZDtcbn1cblxuIl19