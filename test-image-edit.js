"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
var genai_1 = require("@google/genai");
var dotenv = require("dotenv");
var fs = require("fs");
dotenv.config({ path: '.env.local' });
var apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
if (!apiKey) {
    console.error("Missing API Key");
    process.exit(1);
}
var genai = new genai_1.GoogleGenAI({ apiKey: apiKey });
function run() {
    return __awaiter(this, void 0, void 0, function () {
        var response1, imagePart, base64Image, mimeType, response2, editedPart, e_1;
        var _a, _b, _c, _d, _e, _f, _g, _h;
        return __generator(this, function (_j) {
            switch (_j.label) {
                case 0:
                    _j.trys.push([0, 3, , 4]);
                    console.log("1. Generating initial image...");
                    return [4 /*yield*/, genai.models.generateContent({
                            model: 'gemini-2.5-flash',
                            contents: [{
                                    role: 'user',
                                    parts: [{ text: "Draw a simple red apple on a white background." }]
                                }],
                            config: {
                                responseModalities: ['IMAGE'],
                            }
                        })];
                case 1:
                    response1 = _j.sent();
                    imagePart = (_d = (_c = (_b = (_a = response1.candidates) === null || _a === void 0 ? void 0 : _a[0]) === null || _b === void 0 ? void 0 : _b.content) === null || _c === void 0 ? void 0 : _c.parts) === null || _d === void 0 ? void 0 : _d.find(function (p) { return p.inlineData; });
                    if (!imagePart) {
                        console.error("No image generated in first step.");
                        console.dir(response1, { depth: null });
                        return [2 /*return*/];
                    }
                    base64Image = imagePart.inlineData.data;
                    mimeType = imagePart.inlineData.mimeType;
                    console.log("Initial image generated. MimeType: ".concat(mimeType, ", Size: ").concat(base64Image.length, " bytes"));
                    fs.writeFileSync('test1.jpg', Buffer.from(base64Image, 'base64'));
                    console.log("2. Attempting to edit the generated image...");
                    return [4 /*yield*/, genai.models.generateContent({
                            model: 'gemini-2.5-flash',
                            contents: [{
                                    role: 'user',
                                    parts: [
                                        { text: "Change the apple to be green." },
                                        { inlineData: { data: base64Image, mimeType: mimeType } }
                                    ]
                                }],
                            config: {
                                responseModalities: ['IMAGE'],
                            }
                        })];
                case 2:
                    response2 = _j.sent();
                    editedPart = (_h = (_g = (_f = (_e = response2.candidates) === null || _e === void 0 ? void 0 : _e[0]) === null || _f === void 0 ? void 0 : _f.content) === null || _g === void 0 ? void 0 : _g.parts) === null || _h === void 0 ? void 0 : _h.find(function (p) { return p.inlineData; });
                    if (!editedPart) {
                        console.error("No image generated in editing step.");
                        console.dir(response2, { depth: null });
                        return [2 /*return*/];
                    }
                    console.log("Edited image generated. Size: ".concat(editedPart.inlineData.data.length, " bytes"));
                    fs.writeFileSync('test2.jpg', Buffer.from(editedPart.inlineData.data, 'base64'));
                    console.log("Success! Both images saved locally.");
                    return [3 /*break*/, 4];
                case 3:
                    e_1 = _j.sent();
                    console.error("Test failed:");
                    console.error(e_1.message);
                    if (e_1.statusDetails)
                        console.error(e_1.statusDetails);
                    return [3 /*break*/, 4];
                case 4: return [2 /*return*/];
            }
        });
    });
}
run();
