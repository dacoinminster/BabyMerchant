// Found here: https://codereview.stackexchange.com/questions/244474/large-number-scales-names-generator

/************************************************************************
* @Function    : numberScaleNameShortScale()
* @Purpose     : Construct full name of the Short Scale Numeral System
*                Using the Conway-Guy system for forming number prefixes
*
* @Version     : 0.02
* @Author      : Mohsen Alyafei
* @Date        : 12 Jun 2020
* @Param       : {number} [Power=0] the power numeral of the base 1000
*                e.g. 1 means 1000^1 = 1,000
*                e.g. 2 means 1000^2 = 1,000,000 (million)
*                e.g. 3 means 1000^3 = 1,000,000,000 (billion)
*
* @Returns     : {string} The name of the large number
* @Example     :
* numberScaleNameShortScale(4);
* // => trillion
*
* numberScaleNameShortScale(21);
* // => vigintillion
*
* @Description : Handles power from 0 to 999
*                The larget scale name is therefor the umber with
*                3,000 zeros (Novenonagintanongentillion)
* @Reference   : https://en.wikipedia.org/wiki/Names_of_large_numbers
*
* For powers n from 1 to 10, prefixes are constructed based on
* standard dictionary entry.
* For larger powers of n (between 11 and 999), prefixes are constructed
* based on the system described by John Horton Conway and Richard K. Guy.
*************************************************************************/

function numberScaleNameShortScale(Power=0) {
// Do this first and get out quick as it is the most used 99% of the time
// You may delete following line if only interested in Powers above 10 (i.e. 1,000^11 and above)
if (Power<11) return ["","thousand","million","billion","trillion","quadrillion","quintillion","sextillion","septillion","octillion","nonillion"][Power];

Power-=1; // Adjust the sequence above power of 10 as these are now systematic

let TensList = [
    [""            ,["","","","" ,"","","" ,"" ,"","" ,false]],
    ["deci"        ,["","","","" ,"","","" ,"n","","n",false]], // 10
    ["viginti"     ,["","","","s","","","s","m","","m",false]], // 20
    ["triginta"    ,["","","","s","","","s","n","","n",true ]], // 30
    ["quadraginta" ,["","","","s","","","s","n","","n",true ]], // 40
    ["quinquaginta",["","","","s","","","s","n","","n",true ]], // 50
    ["sexaginta"   ,["","","","" ,"","","" ,"n","","n",true ]], // 60
    ["septuaginta" ,["","","","" ,"","","" ,"n","","n",true ]], // 70
    ["octoginta"   ,["","","","" ,"","","x","m","","m",true ]], // 80
    ["nonaginta"   ,["","","","" ,"","","" ,"" ,"","" ,true ]]  // 90
];
let HundredsList = [
    [""            ,["","","","" ,"","","" ,"" ,"","" ]],
    ["centi"       ,["","","","" ,"","","x","n","","n"]], // 100
    ["ducenti"     ,["","","","" ,"","","" ,"n","","n"]], // 200
    ["trecenti"    ,["","","","s","","","s","n","","n"]], // 300
    ["quadringenti",["","","","s","","","s","n","","n"]], // 400
    ["quingenti"   ,["","","","s","","","s","n","","n"]], // 500
    ["sescenti"    ,["","","","" ,"","","" ,"n","","n"]], // 600
    ["septingenti" ,["","","","" ,"","","" ,"n","","n"]], // 700
    ["octingenti"  ,["","","","" ,"","","x","m","","m"]], // 800
    ["nongenti"    ,["","","","" ,"","","" ,"" ,"","" ]]  // 900
];

 let Hund     = Math.floor(Power / 100),      // Hundred Digit
     Ten      = Math.floor(Power % 100 / 10), // Ten Digit
     Unit     = Power % 10 % 10,              // Unit Digit
     UnitName = ["","un","duo","tre","quattuor","quin","se","septe","octo","nove"][Unit], // Get Unit Name from Array
     TenName  = TensList [Ten][0],            // Get Tens Name from Array
     HundName = HundredsList[Hund][0];        // Get Hundreds Name from Array

// convert Ten names ending with "a" to "i" if it was prceeding the "llion" word
if (!Hund && TensList[Ten][1][10]) TenName = TenName.slice(0,-1)+"i";

// Pickup and add the correct suffix to the Unit Name (s,x,n, or m)
 if (Ten) TenName           =      TensList[Ten] [1][Unit]+TenName;
 if (Hund && !Ten) HundName =  HundredsList[Hund][1][Unit]+HundName;

 return UnitName + TenName + HundName + "llion"; // Create name
}

// Number formatting helper moved from app.js
function getDisplayNumber(num, compact = '') {
  var modIndex = Math.floor(Math.log10(num) / 3) - 1;
  if (compact != '') {
    var mod = ['k', 'm', 'b', 't', 'qd', 'qn', 'sx', 'sp', 'oc', 'nn', 'dc'];
    if (num < 1000 || (compact != 'super' && num < 2000)) {
      return num.toLocaleString();
    } else if (modIndex < mod.length) {
      num /= Math.pow(1000, modIndex + 1);
      if (compact == 'super') {
        return Math.round(num) + mod[modIndex];
      } else {
        return num.toPrecision(3) + mod[modIndex];
      }
    } else {
      if (compact == 'super') {
        return num.toExponential(0);
      } else {
        return num.toExponential(2);
      }
    }
  } else {
    modIndex--;
    if (num < 2000000) {
      return num.toLocaleString();
    } else if (modIndex < 998) {
      num /= Math.pow(1000, modIndex + 2);
      return num.toPrecision(4) + ' ' + numberScaleNameShortScale(modIndex + 2);
    } else {
      return num.toExponential(5);
    }
  }
}
