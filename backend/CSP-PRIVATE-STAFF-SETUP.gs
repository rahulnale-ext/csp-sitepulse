/** PRIVATE STAFF ROSTER — DO NOT UPLOAD THIS FILE TO GITHUB.
 * Add as a separate .gs file ONLY inside your private Google Apps Script project.
 * Run seedPrivateCspStaff() after setupProject().
 * Existing users and existing nonempty staff roster rows are not overwritten.
 */
function seedPrivateCspStaff(){
  const roster = [
  [
    "1",
    "raju.venkatesh-ext@sadhguru.org",
    "99898 95660",
    "Raju venkatesh",
    "",
    "",
    "",
    "",
    "",
    "Kannan<br>Murugesh<br>Abhijaya"
  ],
  [
    "2",
    "murugesh.subbappa-ext@sadhguru.org",
    "91770 32993",
    "Murugesh Subbappa",
    "vignesh.mani@sadhguru.org",
    "824 808 3687",
    "Vignesh",
    "",
    "",
    ""
  ],
  [
    "3",
    "ishaansharma1925@gmail.com",
    "93996 65156",
    "Ayush",
    "",
    "",
    "",
    "",
    "",
    ""
  ],
  [
    "4",
    "gunasekaran.n4666@gmail.com",
    "91596 94666",
    "Guna",
    "sivakumar.pichaimuthu@sadhguru.org",
    "94429 15000",
    "Siva",
    "",
    "",
    ""
  ],
  [
    "5",
    "balakrishnan.erusappan@sadhguru.org",
    "99446 57775",
    "Balakrishnan",
    "bankim.mehta@sadhguru.org",
    "84383 01351",
    "Bankim",
    "kannan.marimuthu@sadhguru.org",
    "97914 98376",
    ""
  ],
  [
    "6",
    "kalaiarasan.pannerselvam-ext@sadhguru.org",
    "72007 16163",
    "Kalai",
    "",
    "",
    "",
    "",
    "",
    ""
  ],
  [
    "7",
    "vasanth.kongarayan-ext@sadhguru.org",
    "63747 59455",
    "Vasant",
    "",
    "",
    "",
    "",
    "",
    ""
  ],
  [
    "8",
    "prakash1999praka@gmail.com",
    "93636 71635",
    "Prakash",
    "",
    "",
    "",
    "",
    "",
    ""
  ],
  [
    "9",
    "thangapandi.meiyakonar-ext@sadhguru.org",
    "877 898 2395",
    "Thangapandi",
    "murugesan.gurusamy@sadhguru.org",
    "99438 94721",
    "Murugesh",
    "",
    "",
    ""
  ],
  [
    "10",
    "rajsuresh1008@gmail.com",
    "80157 22698",
    "SURESH",
    "",
    "",
    "",
    "abhijaya@sadhguru.org",
    "7774016404",
    ""
  ],
  [
    "11",
    "kartikeya.hanmuga-ext@sadhguru.org",
    "70107 72023",
    "KARTIKEYAN",
    "",
    "",
    "",
    "",
    "",
    ""
  ],
  [
    "12",
    "karthikg2803200372@gmail.com",
    "72001 24221",
    "KARTIK",
    "",
    "",
    "",
    "",
    "",
    ""
  ]
];
  const props=PropertiesService.getScriptProperties();
  if(!props.getProperty('SPREADSHEET_ID'))throw new Error('Run setupProject() first.');
  props.setProperty('CSP_PRIVATE_STAFF_JSON',JSON.stringify(roster));
  const ss=SpreadsheetApp.openById(props.getProperty('SPREADSHEET_ID'));
  seedScreenshotProfilesSheet_(ss);
  Logger.log('Review private staff list in CSP_Staff_Profiles: '+ss.getUrl());
  return {ok:true,source:'CSP_Staff_Profiles',rows:roster.length};
}
