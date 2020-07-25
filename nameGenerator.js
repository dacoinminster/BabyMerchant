var nameParts = {

	firstCons: [
		{ cons: 'B', prob: 8 },
		{ cons: 'Bl', prob: 2 },
		{ cons: 'Br', prob: 2 },
		{ cons: 'C', prob: 8 },
		{ cons: 'Ch', prob: 5 },
		{ cons: 'Cl', prob: 2 },
		{ cons: 'Cr', prob: 2 },
		{ cons: 'D', prob: 9 },
		{ cons: 'Dr', prob: 2 },
		{ cons: 'F', prob: 5 },
		{ cons: 'Fl', prob: 1 },
		{ cons: 'Fr', prob: 1 },
		{ cons: 'G', prob: 7 },
		{ cons: 'Gh', prob: 1 },
		{ cons: 'Gl', prob: 2 },
		{ cons: 'Gr', prob: 2 },
		{ cons: 'H', prob: 7 },
		{ cons: 'J', prob: 12 },
		{ cons: 'K', prob: 5 },
		{ cons: 'L', prob: 10 },
		{ cons: 'M', prob: 10 },
		{ cons: 'N', prob: 10 },
		{ cons: 'P', prob: 8 },
		{ cons: 'Ph', prob: 1 },
		{ cons: 'Pl', prob: 2 },
		{ cons: 'Pr', prob: 2 },
		{ cons: 'Qu', prob: 1 },
		{ cons: 'R', prob: 15 },
		{ cons: 'S', prob: 15 },
		{ cons: 'Sh', prob: 7 },
		{ cons: 'Shr', prob: 3 },
		{ cons: 'Sl', prob: 3 },
		{ cons: 'T', prob: 12 },
		{ cons: 'Th', prob: 10 },
		{ cons: 'Thr', prob: 3 },
		{ cons: 'Tr', prob: 2 },
		{ cons: 'V', prob: 2 },
		{ cons: 'W', prob: 3 },
		{ cons: 'Wh', prob: 2 },
		{ cons: 'X', prob: 1 },
		{ cons: 'Y', prob: 2 },
		{ cons: 'Z', prob: 2 }
	],

	middleCons: [
		{ cons: 'b', prob: 8 },
		{ cons: 'bb', prob: 0 },
		{ cons: 'bl', prob: 2 },
		{ cons: 'br', prob: 2 },
		{ cons: 'd', prob: 8 },
		{ cons: 'dd', prob: 0 },
		{ cons: 'dr', prob: 2 },
		{ cons: 'f', prob: 4 },
		{ cons: 'fl', prob: 1 },
		{ cons: 'fr', prob: 1 },
		{ cons: 'g', prob: 8 },
		{ cons: 'gg', prob: 0 },
		{ cons: 'gh', prob: 0 },
		{ cons: 'gl', prob: 1 },
		{ cons: 'gr', prob: 2 },
		{ cons: 'h', prob: 7 },
		{ cons: 'j', prob: 1 },
		{ cons: 'k', prob: 5 },
		{ cons: 'l', prob: 15 },
		{ cons: 'll', prob: 0 },
		{ cons: 'm', prob: 10 },
		{ cons: 'mm', prob: 0 },
		{ cons: 'n', prob: 10 },
		{ cons: 'nn', prob: 0 },
		{ cons: 'p', prob: 8 },
		{ cons: 'ph', prob: 1 },
		{ cons: 'pl', prob: 2 },
		{ cons: 'pp', prob: 0 },
		{ cons: 'pr', prob: 2 },
		{ cons: 'qu', prob: 1 },
		{ cons: 'r', prob: 13 },
		{ cons: 'rr', prob: 2 },
		{ cons: 'rn', prob: 2 },
		{ cons: 's', prob: 15},
		{ cons: 'sh', prob: 10 },
		{ cons: 'shr', prob: 3 },
		{ cons: 'sl', prob: 3 },
		{ cons: 'ss', prob: 0 },
		{ cons: 't', prob: 15 },
		{ cons: 'tch', prob: 3 },
		{ cons: 'th', prob: 10 },
		{ cons: 'thr', prob: 3 },
		{ cons: 'tr', prob: 3 },
		{ cons: 'tt', prob: 0 },
		{ cons: 'v', prob: 3 },
		{ cons: 'w', prob: 3 },
		{ cons: 'wh', prob: 2 },
		{ cons: 'x', prob: 3 },
		{ cons: 'y', prob: 3 },
		{ cons: 'z', prob: 2 }
	],

	endCons: [
		{ cons: 'b', prob: 8 },
		{ cons: 'bb', prob: 0 },
		{ cons: 'c', prob: 8 },
		{ cons: 'ch', prob: 5 },
		{ cons: 'ck', prob: 4 },
		{ cons: 'd', prob: 10 },
		{ cons: 'dd', prob: 0 },
		{ cons: 'f', prob: 5 },
		{ cons: 'ff', prob: 0 },
		{ cons: 'g', prob: 5 },
		{ cons: 'h', prob: 2 },
		{ cons: 'j', prob: 0 },
		{ cons: 'k', prob: 10 },
		{ cons: 'l', prob: 8 },
		{ cons: 'll', prob: 4 },
		{ cons: 'm', prob: 10 },
		{ cons: 'mm', prob: 0 },
		{ cons: 'n', prob: 10 },
		{ cons: 'nn', prob: 0 },
		{ cons: 'p', prob: 10 },
		{ cons: 'ph', prob: 1 },
		{ cons: 'pp', prob: 0 },
		{ cons: 'r', prob: 15 },
		{ cons: 'rn', prob: 4 },
		{ cons: 'rr', prob: 0 },
		{ cons: 's', prob: 15 },
		{ cons: 'sh', prob: 10 },
		{ cons: 'ss', prob: 0 },
		{ cons: 't', prob: 15 },
		{ cons: 'tch', prob: 3 },
		{ cons: 'th', prob: 10 },
		{ cons: 'tt', prob: 0 },
		{ cons: 'v', prob: 3 },
		{ cons: 'w', prob: 3 },
		{ cons: 'x', prob: 3 },
		{ cons: 'y', prob: 3 },
		{ cons: 'z', prob: 3 },
		{ cons: 'zz', prob: 0 }
	],

	firstVowel: [
		{ vowel: 'A', prob: 30 },
		{ vowel: 'E', prob: 10 },
		{ vowel: 'I', prob: 10 },
		{ vowel: 'O', prob: 15 },
		{ vowel: 'U', prob: 5 }
	],

	middleVowel: [
		{ vowel: 'a', prob: 50 },
		{ vowel: 'e', prob: 10 },
		{ vowel: 'i', prob: 10 },
		{ vowel: 'o', prob: 20 },
		{ vowel: 'u', prob: 5 },
		{ vowel: 'aa', prob: 0 },
		{ vowel: 'ae', prob: 0 },
		{ vowel: 'ai', prob: 1 },
		{ vowel: 'ao', prob: 1 },
		{ vowel: 'au', prob: 1 },
		{ vowel: 'ea', prob: 1 },
		{ vowel: 'ee', prob: 2 },
		{ vowel: 'ei', prob: 1 },
		{ vowel: 'eo', prob: 1 },
		{ vowel: 'eu', prob: 0 },
		{ vowel: 'ia', prob: 2 },
		{ vowel: 'ie', prob: 1 },
		{ vowel: 'ii', prob: 0 },
		{ vowel: 'io', prob: 2 },
		{ vowel: 'iu', prob: 0 },
		{ vowel: 'oa', prob: 1 },
		{ vowel: 'oe', prob: 0 },
		{ vowel: 'oi', prob: 1 },
		{ vowel: 'oo', prob: 3 },
		{ vowel: 'ou', prob: 1 },
		{ vowel: 'ua', prob: 0 },
		{ vowel: 'ue', prob: 0 },
		{ vowel: 'ui', prob: 0 },
		{ vowel: 'uo', prob: 0 },
		{ vowel: 'uu', prob: 0 }
	],

	endVowel: [
		{ vowel: 'a', prob: 50 },
		{ vowel: 'e', prob: 2 },
		{ vowel: 'i', prob: 5 },
		{ vowel: 'o', prob: 25 },
		{ vowel: 'u', prob: 1 },
		{ vowel: 'aa', prob: 0 },
		{ vowel: 'ae', prob: 0 },
		{ vowel: 'ai', prob: 0 },
		{ vowel: 'ao', prob: 1 },
		{ vowel: 'au', prob: 0 },
		{ vowel: 'ea', prob: 1 },
		{ vowel: 'ee', prob: 2 },
		{ vowel: 'ei', prob: 0 },
		{ vowel: 'eo', prob: 1 },
		{ vowel: 'eu', prob: 0 },
		{ vowel: 'ia', prob: 4 },
		{ vowel: 'ie', prob: 0 },
		{ vowel: 'io', prob: 2 },
		{ vowel: 'oa', prob: 2 },
		{ vowel: 'oe', prob: 0 },
		{ vowel: 'oi', prob: 0 },
		{ vowel: 'oo', prob: 1 },
		{ vowel: 'ou', prob: 0 },
		{ vowel: 'ua', prob: 0 },
		{ vowel: 'ue', prob: 0 },
		{ vowel: 'ui', prob: 0 },
		{ vowel: 'uo', prob: 0 },
		{ vowel: 'uu', prob: 0 }
	]
}


var firstConsTotal = 0;
var firstConsArr = [];
var firstConsIndex = 0;

for(var i in nameParts.firstCons) {
	firstConsTotal += nameParts.firstCons[i].prob;
	for(var j = 0; j < nameParts.firstCons[i].prob; j++) {
		firstConsArr[firstConsIndex+j] = nameParts.firstCons[i].cons;
	}
	firstConsIndex += j;
}

var middleConsTotal = 0;
var middleConsArr = [];
var middleConsIndex = 0;
for(var i in nameParts.middleCons) {
	middleConsTotal += nameParts.middleCons[i].prob;
	for(var j = 0; j < nameParts.middleCons[i].prob; j++) {
		middleConsArr[middleConsIndex+j] = nameParts.middleCons[i].cons;
	}
	middleConsIndex += j;
}

var endConsTotal = 0;
var endConsArr = [];
var endConsIndex = 0;
for(var i in nameParts.endCons) {
	endConsTotal += nameParts.endCons[i].prob;
	for(var j = 0; j < nameParts.endCons[i].prob; j++) {
		endConsArr[endConsIndex+j] = nameParts.endCons[i].cons;
	}
	endConsIndex += j;
}

var firstVowelTotal = 0;
var firstVowelArr = [];
var firstVowelIndex = 0;
for(var i in nameParts.firstVowel) {
	firstVowelTotal += nameParts.firstVowel[i].prob;
	for(var j = 0; j < nameParts.firstVowel[i].prob; j++) {
		firstVowelArr[firstVowelIndex+j] = nameParts.firstVowel[i].vowel;
	}
	firstVowelIndex += j;
}

var middleVowelTotal = 0;
var middleVowelArr = [];
var middleVowelIndex = 0;
for(var i in nameParts.middleVowel) {
	middleVowelTotal += nameParts.middleVowel[i].prob;
	for(var j = 0; j < nameParts.middleVowel[i].prob; j++) {
		middleVowelArr[middleVowelIndex+j] = nameParts.middleVowel[i].vowel;
	}
	middleVowelIndex += j;
}

var endVowelTotal = 0;
var endVowelArr = [];
var endVowelIndex = 0;
for(var i in nameParts.endVowel) {
	endVowelTotal += nameParts.endVowel[i].prob;
	for(var j = 0; j < nameParts.endVowel[i].prob; j++) {
		endVowelArr[endVowelIndex+j] = nameParts.endVowel[i].vowel;
	}
	endVowelIndex += j;
}

function generateConsonant(wordPart) {
	consonant = '';
	if(wordPart == 0) {
		whichCons = Math.floor(Math.random()*firstConsTotal);
		consonant = firstConsArr[whichCons];
	} else if(wordPart == 1) {
		whichCons = Math.floor(Math.random()*middleConsTotal);
		consonant = middleConsArr[whichCons];
	} else {
		whichCons = Math.floor(Math.random()*endConsTotal);
		consonant = endConsArr[whichCons];
	}
	return consonant;
}


function generateVowel(wordPart) {
	vowel = '';
	if(wordPart == 0) {
		whichVowel = Math.floor(Math.random()*firstVowelTotal);
		vowel = firstVowelArr[whichVowel];
	} else if(wordPart == 1) {
		whichVowel = Math.floor(Math.random()*middleVowelTotal);
		vowel = middleVowelArr[whichVowel];
	} else {
		whichVowel = Math.floor(Math.random()*endVowelTotal);
		vowel = endVowelArr[whichVowel];
	}
	return vowel;
}

function generateName(numSyllables) {
	var startsWithCons = true;
	var endsWithCons = true;
	if(Math.random() > 0.6) {
		startsWithCons = false;
	}
	if(Math.random() > 0.6) {
		endsWithCons = false;
	}
	if(numSyllables == 1 && !startsWithCons && !endsWithCons) {
		// Single-syllable names must have a consonant
		if(Math.random() > 0.5) {
			startsWithCons = true;
		} else {
			endsWithCons = true;
		}
	}
	var wordPart = 0;	// 0=beginning of name
	var nameToReturn = '';
	if(startsWithCons) {
		nameToReturn += generateConsonant(wordPart);
		wordPart = 1;	// 1= middle of name
	}
	while(numSyllables > 1) {
		nameToReturn += generateVowel(wordPart);
		wordPart = 1;	// 1= middle of name
		nameToReturn += generateConsonant(wordPart);
		numSyllables--;
	}
	if(!endsWithCons) {
		wordPart = 2; // 2= end of name
	}
	nameToReturn += generateVowel(wordPart);
	if(endsWithCons) {
		wordPart = 2; // 2= end of name
		nameToReturn += generateConsonant(wordPart);
	}
	return nameToReturn;
}

function getRandomName() {
	var numSyllables = 1;
	roll = Math.random();
	if(roll > 0.1) {
		do {
			numSyllables++;
				roll = Math.random();
		} while(roll < 0.4 && numSyllables < 10);
	}
	//numSyllables += 8;
	return generateName(numSyllables);
}
