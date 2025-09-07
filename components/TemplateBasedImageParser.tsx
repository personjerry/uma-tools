import { h, Fragment } from 'preact';
import { useState, useRef } from 'preact/hooks';
import Tesseract from 'tesseract.js';

import { HorseState } from './HorseDefTypes';

// Declare global cv object from OpenCV.js
declare const cv: any;

interface ParsedUmaData {
	outfit: string;
	name: string;
	stats: {
		speed: number;
		stamina: number;
		power: number;
		guts: number;
		wisdom: number;
	};
	aptitudes: {
		track: { turf: string; dirt: string };
		distance: { sprint: string; mile: string; medium: string; long: string };
		style: { front: string; pace: string; late: string; end: string };
	};
	skills: string[];
}

	interface TemplateMatch {
		x: number;
		y: number;
		scaleX: number;
		scaleY: number;
		confidence: number;
	}

interface DataRegion {
	name: string;
	x: number;
	y: number;
	width: number;
	height: number;
	type: 'stats' | 'aptitudes' | 'skills' | 'name';
}

interface ImageParserProps {
	onDataParsed: (data: ParsedUmaData) => void;
	onError: (error: string) => void;
}

// Template positions in reference image
const TEMPLATE_POSITIONS = {
	change: { x: 852, y: 292 },
	headers: { x: 38, y: 404 }
};

// Data regions in reference image
const DATA_REGIONS: DataRegion[] = [
	// Uma outfit/title
	{ name: 'uma_outfit', x: 553, y: 117, width: 456, height: 84, type: 'name' },
	// Uma name
	{ name: 'uma_name', x: 565, y: 195, width: 420, height: 64, type: 'name' },
	
	// Stats
	{ name: 'speed', x: 118, y: 453, width: 106, height: 56, type: 'stats' },
	{ name: 'stamina', x: 319, y: 453, width: 106, height: 56, type: 'stats' },
	{ name: 'power', x: 523, y: 453, width: 106, height: 56, type: 'stats' },
	{ name: 'guts', x: 731, y: 453, width: 106, height: 56, type: 'stats' },
	{ name: 'wit', x: 923, y: 453, width: 106, height: 56, type: 'stats' },
	
	// Track aptitudes
	{ name: 'turf_aptitude', x: 386, y: 551, width: 40, height: 40, type: 'aptitudes' },
	{ name: 'dirt_aptitude', x: 578, y: 551, width: 40, height: 40, type: 'aptitudes' },
	
	// Distance aptitudes
	{ name: 'sprint_aptitude', x: 386, y: 610, width: 40, height: 40, type: 'aptitudes' },
	{ name: 'mile_aptitude', x: 578, y: 610, width: 40, height: 40, type: 'aptitudes' },
	{ name: 'medium_aptitude', x: 770, y: 610, width: 40, height: 40, type: 'aptitudes' },
	{ name: 'long_aptitude', x: 960, y: 610, width: 40, height: 40, type: 'aptitudes' },
	
	// Style aptitudes
	{ name: 'front_aptitude', x: 386, y: 672, width: 40, height: 40, type: 'aptitudes' },
	{ name: 'pace_aptitude', x: 578, y: 672, width: 40, height: 40, type: 'aptitudes' },
	{ name: 'late_aptitude', x: 770, y: 672, width: 40, height: 40, type: 'aptitudes' },
	{ name: 'end_aptitude', x: 960, y: 672, width: 40, height: 40, type: 'aptitudes' },
	
	// Skills will be generated dynamically based on image height
];

// Generate skill regions dynamically based on image height
function generateSkillRegions(imageHeight: number, scale: number, offset: { x: number; y: number }): DataRegion[] {
	const skillRegions: DataRegion[] = [];
	const skillYInterval = 112; // Y interval between skills
	const startY = 864; // Starting Y position for first skill row
	const leftX = 112; // Left column X position
	const rightX = 615; // Right column X position
	const skillWidth = 320;
	const skillHeight = 68;
	
	let skillIndex = 1;
	let currentY = startY;
	
	// Continue adding skills until we go past the image bounds
	while (currentY + skillHeight < imageHeight) {
		// Left column skill
		const leftSkillRegion = {
			name: `skill_${skillIndex}`,
			x: Math.round(leftX * scale + offset.x),
			y: Math.round(currentY * scale + offset.y),
			width: Math.round(skillWidth * scale),
			height: Math.round(skillHeight * scale),
			type: 'skills' as const
		};
		skillRegions.push(leftSkillRegion);
		skillIndex++;
		
		// Right column skill
		const rightSkillRegion = {
			name: `skill_${skillIndex}`,
			x: Math.round(rightX * scale + offset.x),
			y: Math.round(currentY * scale + offset.y),
			width: Math.round(skillWidth * scale),
			height: Math.round(skillHeight * scale),
			type: 'skills' as const
		};
		skillRegions.push(rightSkillRegion);
		skillIndex++;
		
		// Move to next row
		currentY += skillYInterval;
	}
	
	console.log(`Generated ${skillRegions.length} skill regions for image height ${imageHeight}`);
	return skillRegions;
}

export function TemplateBasedImageParser({ onDataParsed, onError }: ImageParserProps) {
	const [isProcessing, setIsProcessing] = useState(false);
	const [progress, setProgress] = useState(0);
	const [lastParsedData, setLastParsedData] = useState<ParsedUmaData | null>(null);
	const [processingStage, setProcessingStage] = useState('');
	const fileInputRef = useRef<HTMLInputElement>(null);
	const fakeProgressInterval = useRef<number | null>(null);

	const initializeOpenCV = async (): Promise<void> => {
		return new Promise((resolve) => {
			if (typeof cv !== 'undefined' && cv.getBuildInformation) {
				// OpenCV is already loaded
				resolve();
			} else if (typeof cv !== 'undefined' && cv.onRuntimeInitialized) {
				// Wait for OpenCV to load
				cv.onRuntimeInitialized = () => {
					resolve();
				};
			} else {
				// OpenCV not loaded yet, wait for it
				const checkOpenCV = () => {
					if (typeof cv !== 'undefined' && cv.getBuildInformation) {
						resolve();
					} else if (typeof cv !== 'undefined' && cv.onRuntimeInitialized) {
						cv.onRuntimeInitialized = () => {
							resolve();
						};
					} else {
						setTimeout(checkOpenCV, 100);
					}
				};
				checkOpenCV();
			}
		});
	};

	const startFakeProgress = () => {
		if (fakeProgressInterval.current) {
			clearInterval(fakeProgressInterval.current);
		}
		fakeProgressInterval.current = window.setInterval(() => {
			setProgress(prev => Math.min(prev + 1, 99));
		}, 1000);
	};

	const stopFakeProgress = () => {
		if (fakeProgressInterval.current) {
			clearInterval(fakeProgressInterval.current);
			fakeProgressInterval.current = null;
		}
	};

	const handleFileSelect = async (event: Event) => {
		const target = event.target as HTMLInputElement;
		const file = target.files?.[0];
		if (!file) return;

		if (!file.type.startsWith('image/')) {
			onError('Please select an image file');
			return;
		}

		setIsProcessing(true);
		setProgress(0);
		setProcessingStage('Loading image...');
		
		// Start fake progress
		startFakeProgress();

		try {
			// Initialize OpenCV
			setProcessingStage('Initializing OpenCV...');
			await initializeOpenCV();
			
			// Load the uploaded image
			const uploadedImage = await loadImage(file);
			console.log('Loaded uploaded image:', uploadedImage.width, 'x', uploadedImage.height);
			setProcessingStage('Loading templates...');

			// Load template images
			const changeTemplate = await loadTemplateImage('./change.jpg');
			const headersTemplate = await loadTemplateImage('./headers.jpg');
			console.log('Loaded templates');
			setProcessingStage('Finding template matches...');

			// Find template matches with multi-scale matching
			console.log('Finding template matches with multi-scale matching...');
			console.log('Uploaded image size:', uploadedImage.width, 'x', uploadedImage.height);
			console.log('Change template size:', changeTemplate.width, 'x', changeTemplate.height);
			console.log('Headers template size:', headersTemplate.width, 'x', headersTemplate.height);
			
			const changeMatch = await findBestTemplateMatch(uploadedImage, changeTemplate, 'change');
			const headersMatch = await findBestTemplateMatch(uploadedImage, headersTemplate, 'headers');
			
			console.log('Best template matches:', { changeMatch, headersMatch });

			if (!changeMatch || !headersMatch) {
				onError('Could not find template matches in the image. Please ensure the image contains the Uma Musume details screen.');
				return;
			}

			// Calculate scales and offset
			const scales = calculateScales(changeMatch, headersMatch);
			const offset = calculateOffset(changeMatch, headersMatch, scales);
			
			console.log('Calculated scales:', scales, 'offset:', offset);

			// Extract data from each region
			setProcessingStage('Extracting data from regions...');
			const extractedData: { [key: string]: string } = {};
			
			// Process static regions first
			for (const region of DATA_REGIONS) {
				const adjustedRegion = adjustRegion(region, scales, offset);
				const regionImage = extractRegion(uploadedImage, adjustedRegion);
				const text = await ocrRegion(regionImage);
				
				extractedData[region.name] = text;
				console.log(`Extracted ${region.name}:`, text);
			}
			
			// Generate and process dynamic skill regions
			const skillRegions = generateSkillRegions(uploadedImage.height, scales.scaleY, offset);
			for (const region of skillRegions) {
				// Check if region is within image bounds
				if (region.x >= 0 && region.y >= 0 && 
					region.x + region.width <= uploadedImage.width && 
					region.y + region.height <= uploadedImage.height) {
					
					const regionImage = extractRegion(uploadedImage, region);
					const text = await ocrRegion(regionImage);
					
					extractedData[region.name] = text;
					console.log(`Extracted ${region.name}:`, text);
				}
			}

			// Parse the extracted data
			const parsedData = parseExtractedData(extractedData);
			setLastParsedData(parsedData);
			onDataParsed(parsedData);
			
		} catch (error) {
			onError(`Failed to process image: ${error.message}`);
		} finally {
			stopFakeProgress();
			setIsProcessing(false);
			setProgress(0);
			setProcessingStage('');
		}
	};

	const loadImage = (file: File): Promise<HTMLImageElement> => {
		return new Promise((resolve, reject) => {
			const img = new Image();
			img.onload = () => resolve(img);
			img.onerror = reject;
			img.src = URL.createObjectURL(file);
		});
	};

	const loadTemplateImage = (src: string): Promise<HTMLImageElement> => {
		return new Promise((resolve, reject) => {
			const img = new Image();
			img.onload = () => resolve(img);
			img.onerror = reject;
			img.src = src;
		});
	};

	const findTemplateMatchNonBlocking = async (image: HTMLImageElement, template: HTMLImageElement): Promise<TemplateMatch | null> => {
		return new Promise((resolve) => {
			// Use setTimeout to yield control to the browser
			setTimeout(() => {
				resolve(findTemplateMatch(image, template));
			}, 0);
		});
	};

	const findTemplateMatchWithThreshold = async (image: HTMLImageElement, template: HTMLImageElement, threshold: number): Promise<TemplateMatch | null> => {
		return new Promise((resolve) => {
			// Use setTimeout to yield control to the browser
			setTimeout(() => {
				resolve(findTemplateMatchWithCustomThreshold(image, template, threshold));
			}, 0);
		});
	};

	const findTemplateMatch = async (image: HTMLImageElement, template: HTMLImageElement): Promise<TemplateMatch | null> => {
		return new Promise((resolve) => {
			// Create canvas for image
			const imageCanvas = document.createElement('canvas');
			const imageCtx = imageCanvas.getContext('2d')!;
			imageCanvas.width = image.width;
			imageCanvas.height = image.height;
			imageCtx.drawImage(image, 0, 0);
			
			// Create canvas for template
			const templateCanvas = document.createElement('canvas');
			const templateCtx = templateCanvas.getContext('2d')!;
			templateCanvas.width = template.width;
			templateCanvas.height = template.height;
			templateCtx.drawImage(template, 0, 0);
			
			// Convert to OpenCV Mat objects
			const imageMat = cv.imread(imageCanvas);
			const templateMat = cv.imread(templateCanvas);
			const resultMat = new cv.Mat();
			
			// Perform template matching using normalized cross correlation
			cv.matchTemplate(imageMat, templateMat, resultMat, cv.TM_CCOEFF_NORMED);
			
			// Find the best match
			const minMaxLoc = cv.minMaxLoc(resultMat);
			const maxVal = minMaxLoc.maxVal;
			const maxLoc = minMaxLoc.maxLoc;
			
			console.log(`Template match confidence: ${maxVal.toFixed(3)} (threshold: 0.7)`);
			
			// Clean up
			imageMat.delete();
			templateMat.delete();
			resultMat.delete();
			
			// Return match if confidence is above threshold
			if (maxVal > 0.7) {
				resolve({
					x: maxLoc.x,
					y: maxLoc.y,
					scaleX: 1.0,
					scaleY: 1.0,
					confidence: maxVal
				});
			} else {
				resolve(null);
			}
		});
	};

	const findTemplateMatchWithCustomThreshold = async (image: HTMLImageElement, template: HTMLImageElement, threshold: number): Promise<TemplateMatch | null> => {
		return new Promise((resolve) => {
			// Create canvas for image
			const imageCanvas = document.createElement('canvas');
			const imageCtx = imageCanvas.getContext('2d')!;
			imageCanvas.width = image.width;
			imageCanvas.height = image.height;
			imageCtx.drawImage(image, 0, 0);
			
			// Create canvas for template
			const templateCanvas = document.createElement('canvas');
			const templateCtx = templateCanvas.getContext('2d')!;
			templateCanvas.width = template.width;
			templateCanvas.height = template.height;
			templateCtx.drawImage(template, 0, 0);
			
			// Convert to OpenCV Mat objects
			const imageMat = cv.imread(imageCanvas);
			const templateMat = cv.imread(templateCanvas);
			const resultMat = new cv.Mat();
			
			// Perform template matching using normalized cross correlation
			cv.matchTemplate(imageMat, templateMat, resultMat, cv.TM_CCOEFF_NORMED);
			
			// Find the best match
			const minMaxLoc = cv.minMaxLoc(resultMat);
			const maxVal = minMaxLoc.maxVal;
			const maxLoc = minMaxLoc.maxLoc;
			
			console.log(`Template match confidence: ${maxVal.toFixed(3)} (threshold: ${threshold})`);
			
			// Clean up
			imageMat.delete();
			templateMat.delete();
			resultMat.delete();
			
			// Return match if confidence is above custom threshold
			if (maxVal > threshold) {
				resolve({
					x: maxLoc.x,
					y: maxLoc.y,
					scaleX: 1.0,
					scaleY: 1.0,
					confidence: maxVal
				});
			} else {
				resolve(null);
			}
		});
	};

	const findTemplateMatchWithMethod = async (image: HTMLImageElement, template: HTMLImageElement, method: number, threshold: number): Promise<TemplateMatch | null> => {
		return new Promise((resolve) => {
			// Create canvas for image
			const imageCanvas = document.createElement('canvas');
			const imageCtx = imageCanvas.getContext('2d')!;
			imageCanvas.width = image.width;
			imageCanvas.height = image.height;
			imageCtx.drawImage(image, 0, 0);
			
			// Create canvas for template
			const templateCanvas = document.createElement('canvas');
			const templateCtx = templateCanvas.getContext('2d')!;
			templateCanvas.width = template.width;
			templateCanvas.height = template.height;
			templateCtx.drawImage(template, 0, 0);
			
			// Convert to OpenCV Mat objects
			const imageMat = cv.imread(imageCanvas);
			const templateMat = cv.imread(templateCanvas);
			const resultMat = new cv.Mat();
			
			// Perform template matching with specified method
			cv.matchTemplate(imageMat, templateMat, resultMat, method);
			
			// Find the best match
			const minMaxLoc = cv.minMaxLoc(resultMat);
			let maxVal, maxLoc;
			
			// For SQDIFF methods, we want the minimum value (best match)
			if (method === cv.TM_SQDIFF || method === cv.TM_SQDIFF_NORMED) {
				maxVal = 1 - minMaxLoc.minVal; // Convert to similarity score
				maxLoc = minMaxLoc.minLoc;
			} else {
				maxVal = minMaxLoc.maxVal;
				maxLoc = minMaxLoc.maxLoc;
			}
			
			console.log(`Template match (method ${method}) confidence: ${maxVal.toFixed(3)} (threshold: ${threshold})`);
			
			// Clean up
			imageMat.delete();
			templateMat.delete();
			resultMat.delete();
			
			// Return match if confidence is above threshold
			if (maxVal > threshold) {
				resolve({
					x: maxLoc.x,
					y: maxLoc.y,
					scaleX: 1.0,
					scaleY: 1.0,
					confidence: maxVal
				});
			} else {
				resolve(null);
			}
		});
	};

	const findBestTemplateMatch = async (image: HTMLImageElement, template: HTMLImageElement, templateName: string): Promise<TemplateMatch | null> => {
		return new Promise((resolve) => {
			// Create canvas for image
			const imageCanvas = document.createElement('canvas');
			const imageCtx = imageCanvas.getContext('2d')!;
			imageCanvas.width = image.width;
			imageCanvas.height = image.height;
			imageCtx.drawImage(image, 0, 0);
			
			// Create canvas for template
			const templateCanvas = document.createElement('canvas');
			const templateCtx = templateCanvas.getContext('2d')!;
			templateCanvas.width = template.width;
			templateCanvas.height = template.height;
			templateCtx.drawImage(template, 0, 0);
			
			// Convert to OpenCV Mat objects
			const imageMat = cv.imread(imageCanvas);
			const templateMat = cv.imread(templateCanvas);
			
			let bestMatch = null;
			let bestConfidence = -1;
			
			// Binary search for optimal scale
			let minScale = 0.3;
			let maxScale = 2.0;
			const maxSteps = 10;
			let stepCount = 0;
			
			// Test a scale and return confidence
			const testScale = (scale: number): number => {
				// Calculate scaled template size
				const scaledWidth = Math.round(template.width * scale);
				const scaledHeight = Math.round(template.height * scale);
				
				// Skip if scaled template is larger than image
				if (scaledWidth > image.width || scaledHeight > image.height) {
					return 0;
				}
				
				// Resize template
				const scaledTemplate = new cv.Mat();
				cv.resize(templateMat, scaledTemplate, new cv.Size(scaledWidth, scaledHeight), 0, 0, cv.INTER_LINEAR);
				
				// Create result matrix
				const resultMat = new cv.Mat();
				
				// Perform template matching
				cv.matchTemplate(imageMat, scaledTemplate, resultMat, cv.TM_CCOEFF_NORMED);
				
				// Find the best match for this scale
				const minMaxLoc = cv.minMaxLoc(resultMat);
				const confidence = minMaxLoc.maxVal;
				const location = minMaxLoc.maxLoc;
				
				// Update best match if this is better
				if (confidence > bestConfidence) {
					bestConfidence = confidence;
					bestMatch = {
						x: location.x,
						y: location.y,
						scaleX: scale,
						scaleY: scale,
						confidence: confidence
					};
				}
				
				// Clean up
				scaledTemplate.delete();
				resultMat.delete();
				
				return confidence;
			};
			
			// Binary search for optimal scale
			const binarySearchScale = () => {
				if (stepCount >= maxSteps) {
					// Clean up
					imageMat.delete();
					templateMat.delete();
					
					console.log(`${templateName} template - Binary search complete: scaleX=${bestMatch?.scaleX?.toFixed(3)}, scaleY=${bestMatch?.scaleY?.toFixed(3)}, confidence=${bestMatch?.confidence?.toFixed(3)}`);
					
					resolve(bestMatch);
					return;
				}
				
				stepCount++;
				
				// Test three points: low, mid, high
				const lowScale = minScale + (maxScale - minScale) * 0.25;
				const midScale = (minScale + maxScale) / 2;
				const highScale = minScale + (maxScale - minScale) * 0.75;
				
				const lowConfidence = testScale(lowScale);
				const midConfidence = testScale(midScale);
				const highConfidence = testScale(highScale);
				
				console.log(`${templateName} step ${stepCount}: scales=[${lowScale.toFixed(2)}, ${midScale.toFixed(2)}, ${highScale.toFixed(2)}], confidences=[${lowConfidence.toFixed(3)}, ${midConfidence.toFixed(3)}, ${highConfidence.toFixed(3)}]`);
				
				// Determine which range to focus on
				if (lowConfidence >= midConfidence && lowConfidence >= highConfidence) {
					// Low range is best
					maxScale = midScale;
				} else if (highConfidence >= midConfidence && highConfidence >= lowConfidence) {
					// High range is best
					minScale = midScale;
				} else {
					// Mid range is best
					minScale = lowScale;
					maxScale = highScale;
				}
				
				// Yield control and continue
				setTimeout(binarySearchScale, 0);
			};
			
			// Start binary search
			binarySearchScale();
		});
	};

	const calculateScales = (changeMatch: TemplateMatch, headersMatch: TemplateMatch): { scaleX: number; scaleY: number } => {
		// Use the average of the detected scales from template matching
		const averageScaleX = (changeMatch.scaleX + headersMatch.scaleX) / 2;
		const averageScaleY = (changeMatch.scaleY + headersMatch.scaleY) / 2;
		console.log(`Calculated scales: X=${averageScaleX.toFixed(3)}, Y=${averageScaleY.toFixed(3)}`);
		console.log(`  Change: X=${changeMatch.scaleX.toFixed(3)}, Y=${changeMatch.scaleY.toFixed(3)}`);
		console.log(`  Headers: X=${headersMatch.scaleX.toFixed(3)}, Y=${headersMatch.scaleY.toFixed(3)}`);
		return { scaleX: averageScaleX, scaleY: averageScaleY };
	};

	const calculateOffset = (changeMatch: TemplateMatch, headersMatch: TemplateMatch, scales: { scaleX: number; scaleY: number }) => {
		// Calculate offset based on template positions using their individual scales
		const changeOffsetX = changeMatch.x - (TEMPLATE_POSITIONS.change.x * changeMatch.scaleX);
		const changeOffsetY = changeMatch.y - (TEMPLATE_POSITIONS.change.y * changeMatch.scaleY);
		const headersOffsetX = headersMatch.x - (TEMPLATE_POSITIONS.headers.x * headersMatch.scaleX);
		const headersOffsetY = headersMatch.y - (TEMPLATE_POSITIONS.headers.y * headersMatch.scaleY);
		
		// Use average offset
		const offset = {
			x: (changeOffsetX + headersOffsetX) / 2,
			y: (changeOffsetY + headersOffsetY) / 2
		};
		
		console.log(`Calculated offset: x=${offset.x.toFixed(1)}, y=${offset.y.toFixed(1)}`);
		return offset;
	};

	const adjustRegion = (region: DataRegion, scales: { scaleX: number; scaleY: number }, offset: { x: number; y: number }): DataRegion => {
		return {
			...region,
			x: Math.round(region.x * scales.scaleX + offset.x),
			y: Math.round(region.y * scales.scaleY + offset.y),
			width: Math.round(region.width * scales.scaleX),
			height: Math.round(region.height * scales.scaleY)
		};
	};

	const extractRegion = (image: HTMLImageElement, region: DataRegion): HTMLCanvasElement => {
		const canvas = document.createElement('canvas');
		const ctx = canvas.getContext('2d')!;
		
		canvas.width = region.width;
		canvas.height = region.height;
		
		ctx.drawImage(
			image,
			region.x, region.y, region.width, region.height,
			0, 0, region.width, region.height
		);
		
		return canvas;
	};

	const ocrRegion = async (canvas: HTMLCanvasElement): Promise<string> => {
		// Convert canvas to blob
		return new Promise((resolve) => {
			canvas.toBlob(async (blob) => {
				if (blob) {
				const { data: { text } } = await Tesseract.recognize(blob, 'eng', {
					// @ts-ignore - Tesseract options
					psm: 8, // Single word
					oem: 1
				});
					resolve(text.trim());
				} else {
					resolve('');
				}
			});
		});
	};

	const parseExtractedData = (data: { [key: string]: string }): ParsedUmaData => {
		// Parse Uma outfit and name
		const outfit = data.uma_outfit || '';
		const name = data.uma_name || 'Unknown Uma';
		
		// Parse stats
		const stats = {
			speed: parseStat(data.speed),
			stamina: parseStat(data.stamina),
			power: parseStat(data.power),
			guts: parseStat(data.guts),
			wisdom: parseStat(data.wit)
		};
		
		// Parse aptitudes
		const aptitudes = {
			track: {
				turf: parseAptitude(data.turf_aptitude),
				dirt: parseAptitude(data.dirt_aptitude)
			},
			distance: {
				sprint: parseAptitude(data.sprint_aptitude),
				mile: parseAptitude(data.mile_aptitude),
				medium: parseAptitude(data.medium_aptitude),
				long: parseAptitude(data.long_aptitude)
			},
			style: {
				front: parseAptitude(data.front_aptitude),
				pace: parseAptitude(data.pace_aptitude),
				late: parseAptitude(data.late_aptitude),
				end: parseAptitude(data.end_aptitude)
			}
		};
		
		// Parse skills dynamically - collect all skill_* entries
		const skills: string[] = [];
		let skillIndex = 1;
		
		// Continue parsing skills until we find no more
		while (data[`skill_${skillIndex}`] !== undefined) {
			const skillText = data[`skill_${skillIndex}`];
			if (skillText && skillText.trim()) {
				skills.push(skillText.trim());
			}
			skillIndex++;
		}
		
		return { outfit, name, stats, aptitudes, skills };
	};

	const parseStat = (text: string): number => {
		// Extract number from text like "S 1012" or just "1012"
		const match = text.match(/(\d{3,4})/);
		return match ? parseInt(match[1]) : 0;
	};

	const parseAptitude = (text: string): string => {
		// Extract letter grade from text
		const match = text.match(/([A-Z])/);
		return match ? match[1] : 'G';
	};

	return (
		<div class="imageParser">
			<h3>Parse Uma from Image (Template-Based)</h3>
			<div class="uploadArea">
				<input
					type="file"
					ref={fileInputRef}
					accept="image/*"
					onChange={handleFileSelect}
					style="display: none"
				/>
				<button
					onClick={() => fileInputRef.current?.click()}
					disabled={isProcessing}
					class="uploadButton"
				>
					{isProcessing ? `Processing... ${progress}%` : 'Select Image'}
				</button>
			</div>
			{isProcessing && (
				<div class="processingContainer">
					<div class="spinner"></div>
					<div class="progressText">{processingStage} {progress}%</div>
					<div class="progressBar">
						<div class="progressFill" style={`width: ${progress}%`}></div>
					</div>
				</div>
			)}
			{lastParsedData && (
				<div class="parsedData">
					<h4>Parsed Data:</h4>
					<div class="statRow">
						<span><strong>Outfit:</strong> {lastParsedData.outfit}</span>
					</div>
					<div class="statRow">
						<span><strong>Name:</strong> {lastParsedData.name}</span>
					</div>
					<div class="statRow">
						<span><strong>Speed:</strong> {lastParsedData.stats.speed}</span>
						<span><strong>Stamina:</strong> {lastParsedData.stats.stamina}</span>
					</div>
					<div class="statRow">
						<span><strong>Power:</strong> {lastParsedData.stats.power}</span>
						<span><strong>Guts:</strong> {lastParsedData.stats.guts}</span>
					</div>
					<div class="statRow">
						<span><strong>Wisdom:</strong> {lastParsedData.stats.wisdom}</span>
					</div>
					<div class="statRow">
						<span><strong>Track:</strong> Turf {lastParsedData.aptitudes.track.turf}, Dirt {lastParsedData.aptitudes.track.dirt}</span>
					</div>
					<div class="statRow">
						<span><strong>Distance:</strong> Sprint {lastParsedData.aptitudes.distance.sprint}, Mile {lastParsedData.aptitudes.distance.mile}, Medium {lastParsedData.aptitudes.distance.medium}, Long {lastParsedData.aptitudes.distance.long}</span>
					</div>
					<div class="statRow">
						<span><strong>Style:</strong> Front {lastParsedData.aptitudes.style.front}, Pace {lastParsedData.aptitudes.style.pace}, Late {lastParsedData.aptitudes.style.late}, End {lastParsedData.aptitudes.style.end}</span>
					</div>
					{lastParsedData.skills.length > 0 && (
						<div class="skillList">
							<strong>Skills:</strong>
							{lastParsedData.skills.map((skill, i) => (
								<div key={i} class="skillItem">{skill}</div>
							))}
						</div>
					)}
				</div>
			)}
		</div>
	);
}
