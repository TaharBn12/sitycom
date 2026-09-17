// ─────────────────────────────────────────────────────────────
//  الولايات (58) + عيّنة من البلديات الأكثر استعمالاً
//  ملاحظة: البلديات الحقيقية تُسحب من Ecotrack عبر
//  GET /api/v1/get/communes  (شاشة: التوصيل ← الإعدادات ← مزامنة)
// ─────────────────────────────────────────────────────────────

export const WILAYAS = [
  [1, 'Adrar', 'أدرار'],
  [2, 'Chlef', 'الشلف'],
  [3, 'Laghouat', 'الأغواط'],
  [4, 'Oum El Bouaghi', 'أم البواقي'],
  [5, 'Batna', 'باتنة'],
  [6, 'Béjaïa', 'بجاية'],
  [7, 'Biskra', 'بسكرة'],
  [8, 'Béchar', 'بشار'],
  [9, 'Blida', 'البليدة'],
  [10, 'Bouira', 'البويرة'],
  [11, 'Tamanrasset', 'تمنراست'],
  [12, 'Tébessa', 'تبسة'],
  [13, 'Tlemcen', 'تلمسان'],
  [14, 'Tiaret', 'تيارت'],
  [15, 'Tizi Ouzou', 'تيزي وزو'],
  [16, 'Alger', 'الجزائر'],
  [17, 'Djelfa', 'الجلفة'],
  [18, 'Jijel', 'جيجل'],
  [19, 'Sétif', 'سطيف'],
  [20, 'Saïda', 'سعيدة'],
  [21, 'Skikda', 'سكيكدة'],
  [22, 'Sidi Bel Abbès', 'سيدي بلعباس'],
  [23, 'Annaba', 'عنابة'],
  [24, 'Guelma', 'قالمة'],
  [25, 'Constantine', 'قسنطينة'],
  [26, 'Médéa', 'المدية'],
  [27, 'Mostaganem', 'مستغانم'],
  [28, "M'Sila", 'المسيلة'],
  [29, 'Mascara', 'معسكر'],
  [30, 'Ouargla', 'ورقلة'],
  [31, 'Oran', 'وهران'],
  [32, 'El Bayadh', 'البيض'],
  [33, 'Illizi', 'إليزي'],
  [34, 'Bordj Bou Arreridj', 'برج بوعريريج'],
  [35, 'Boumerdès', 'بومرداس'],
  [36, 'El Tarf', 'الطارف'],
  [37, 'Tindouf', 'تندوف'],
  [38, 'Tissemsilt', 'تيسمسيلت'],
  [39, 'El Oued', 'الوادي'],
  [40, 'Khenchela', 'خنشلة'],
  [41, 'Souk Ahras', 'سوق أهراس'],
  [42, 'Tipaza', 'تيبازة'],
  [43, 'Mila', 'ميلة'],
  [44, 'Aïn Defla', 'عين الدفلى'],
  [45, 'Naâma', 'النعامة'],
  [46, 'Aïn Témouchent', 'عين تموشنت'],
  [47, 'Ghardaïa', 'غرداية'],
  [48, 'Relizane', 'غليزان'],
  [49, "El M'Ghair", 'المغير'],
  [50, 'El Meniaa', 'المنيعة'],
  [51, 'Ouled Djellal', 'أولاد جلال'],
  [52, 'Bordj Badji Mokhtar', 'برج باجي مختار'],
  [53, 'Béni Abbès', 'بني عباس'],
  [54, 'Timimoun', 'تيميمون'],
  [55, 'Touggourt', 'تقورت'],
  [56, 'Djanet', 'جانت'],
  [57, 'In Salah', 'عين صالح'],
  [58, 'In Guezzam', 'عين قزام'],
];

// بلديات مبدئية (تُستبدل/تُكمل تلقائياً عند المزامنة مع Ecotrack)
export const COMMUNES = {
  16: ['Alger Centre', 'Bab Ezzouar', 'Bordj El Kiffan', 'Birkhadem', 'Kouba', 'Hussein Dey', 'El Harrach', 'Ain Taya', 'Zeralda', 'Birtouta', 'Baraki', 'Draria', 'Dely Ibrahim', 'Cheraga', 'Ben Aknoun', 'Hydra', 'Bab El Oued', 'Casbah', 'Bologhine', 'Beni Messous', 'Rouiba', 'Reghaia', 'Dar El Beida', 'Sidi Moussa', 'Oued Smar', 'Bab Zaroura', 'Ben Aknoun'],
  31: ['Oran', 'Es Senia', 'Bir El Djir', 'Ain El Turk', 'Arzew', 'Sidi Chahmi', 'Hassi Bounif', 'Boutlelis', 'El Kerma', 'Misserghin', 'Gdyel', 'Ain El Bia', 'Bethioua', 'Mers El Kebir', 'Oued Tlelat', 'Tafraoui', 'Boufatis'],
  25: ['Constantine', 'El Khroub', 'Ain Smara', 'Hamma Bouziane', 'Didouche Mourad', 'Beni Hamiden', 'Zighoud Youcef', 'Messaoud Boudjeriou', 'Ain Abid', 'Ouled Rahmoun', 'Chelghoum Laid', 'Ali Mendjeli', 'Bekira', 'Ibn Ziad'],
  6: ['Béjaïa', 'Akbou', 'Amizour', 'El Kseur', 'Sidi Aich', 'Kherrata', 'Souk El Tenine', 'Tichy', 'Aokas', 'Bordj Menaiel', 'Timezrit', 'Barbacha', 'Chemini', 'Ouzellaguen', 'Ighil Ali', 'Beni Maouche'],
  19: ['Sétif', 'El Eulma', 'Ain Oulmene', 'Bougaa', 'Ain Arnat', 'Ain Azel', 'Beni Ourtilane', 'Babor', 'Bir El Arch', 'Guidjel', 'Hamma', 'Maan', 'Ait Naoual Mezada', 'Bousselam'],
  30: ['Ouargla', 'Hassi Messaoud', 'Ain Beida', 'Rouissat', 'Sidi Khouiled', 'N Goussa', 'Oued Mya', 'Berriane', 'Zelfana', 'El Hadjira'],
  35: ['Boumerdès', 'Bordj Menaiel', 'Boudouaou', 'Dellys', 'Thenia', 'Zemmouri', 'Issers', 'Khemis El Khechna', 'Corso', 'Baghlia', 'Ouled Aissa', 'Legata', 'Si Mustapha', 'Aafir', 'Chabet El Ameur'],
  9: ['Blida', 'Boufarik', 'Beni Mered', 'Oued Alleug', 'El Affroun', 'Mouzaia', 'Sidi Aissa', 'Bouarfa', 'Chiffa', 'Beni Tamou', 'Soumaa', 'Ouled Yaich', 'Chebli', 'Bougara', 'Hammam Melouane'],
  42: ['Tipaza', 'Koléa', 'Hadjout', 'Cherchell', 'Fouka', 'Bou Ismaïl', 'Bouharoun', 'Gouraya', 'Sidi Amar', 'Ahmar El Ain', 'Nador', 'Sidi Rached', 'Menaceur', 'Berbessa'],
  5: ['Batna', 'Barika', 'Ain Touta', 'Merouana', 'Tazoult', 'Arris', 'N Gaous', 'Ras El Aioun', 'Seriana', 'Ain Djasser', 'Bouzina', 'Chir', 'El Madher', 'Timgad', 'Ouled Si Slimane'],
  7: ['Biskra', 'Tolga', 'Ourlal', 'Sidi Okba', 'Zeribet El Oued', 'Ain Naga', 'El Kantara', 'Doucen', 'M Chouneche', 'Foughala', 'Lichana', 'Bordj Ben Azzouz', 'El Outaya', 'Branis'],
  47: ['Ghardaïa', 'Metlili', 'El Guerrara', 'Berriane', 'Daya Ben Dahoua', 'Zelfana', 'Bounoura', 'El Atteuf', 'Mansoura', 'Sebseb'],
  13: ['Tlemcen', 'Maghnia', 'Ghazaouet', 'Nedroma', 'Remchi', 'Chetouane', 'Sabra', 'Hennaya', 'Bensekrane', 'Sebdou', 'Bab El Assa', 'Beni Boussaid', 'Sidi Djillali'],
  15: ['Tizi Ouzou', 'Azazga', 'Boghni', 'Larbaa Nath Irathen', 'Ain El Hammam', 'Bouzeguene', 'Draa El Mizan', 'Ouadhia', 'Beni Douala', 'Maatka', 'Tigzirt', 'Mizrana', 'Ifigha', 'Mekla'],
  23: ['Annaba', 'El Bouni', 'Sidi Amar', 'El Hadjar', 'Berrahal', 'Ain Berda', 'Chetaibi', 'Bouhadjar', 'Dréan'],
  21: ['Skikda', 'Collo', 'Azzaba', 'El Hadaiek', 'Tamalous', 'Beni Bechir', 'Ain Kechra', 'Zitouna', 'Sidi Mezghiche', 'Emdjez Edchich', 'Ouled Attia'],
  26: ['Médéa', 'Berrouaghia', 'Ksar El Boukhari', 'Beni Slimane', 'Souaghi', 'Tablat', 'El Omaria', 'Ain Boucif', 'Si Mahdjoub', 'Ouzera', 'Ouled Antar', 'Chellalat El Adhaoura'],
  34: ['Bordj Bou Arreridj', 'El Anasser', 'Bordj Ghedir', 'Ras El Oued', 'Bir Kasdali', 'Ain Tagrout', 'Tesmart', 'Mansoura', 'Medjana', 'Bordj Zemoura', 'Haraza'],
  39: ['El Oued', 'Debila', 'Hassi Khalifa', 'Reguiba', 'Bayadha', 'Guemar', 'Oued El Alenda', 'Maghrane', 'Hamraia', 'Mih Ouansa', 'Nakhla', 'Taleb Larbi', 'Sidi Aoun'],
  28: ["M'Sila", 'Bou Saada', 'Sidi Aissa', 'Ain El Hadjel', 'Melloumene', 'Hammam Dhalaa', 'Ben Srour', 'Maadid', 'Ain Melh', 'Ouled Derradj', 'Berhoum'],
  22: ['Sidi Bel Abbès', 'Sidi Lahcene', 'Ain El Berd', 'Telagh', 'Ras El Ma', 'Moulay Slissen', 'Sfisef', 'Tenesra', 'Marhoum'],
  3: ['Laghouat', 'Ain Madhi', 'Ksar El Hirane', 'Aflou', 'Sidi Makhlouf', 'Hassi R Mel', 'Gueltat Sidi Saad', 'Brida', 'Taouila'],
  17: ['Djelfa', 'Ain Oussera', 'Messad', 'Ain Chouhada', 'Hassi Bahbah', 'El Idrissia', 'Dar Chioukh', 'Moudjbara'],
  29: ['Mascara', 'Mohammadia', 'Sig', 'Tighenif', 'Ain Fares', 'Ghriss', 'Oued El Abtal', 'Hachem', 'Bou Hanifia', 'El Bordj', 'Froha'],
};

// أسعار تجريبية (تُستبدل بالأسعار الحقيقية من GET /api/v1/get/fees)
export function mockFees() {
  return WILAYAS.map(([id, fr, ar]) => {
    const north = id <= 48 && ![11, 33, 37, 49, 50, 51, 52, 53, 54, 56, 57, 58].includes(id);
    const base = north ? 500 + ((id * 37) % 350) : 900 + ((id * 53) % 700);
    return {
      wilaya_id: id,
      wilaya_name: fr,
      wilaya_name_ar: ar,
      livraison: { tarif: String(base), tarif_stopdesk: String(base - 100) },
      pickup: { tarif: String(base + 100), tarif_stopdesk: String(base) },
      echange: { tarif: String(base + 200), tarif_stopdesk: String(base + 100) },
      recouvrement: { tarif: String(300), tarif_stopdesk: String(250) },
      retour: { tarif: String(Math.round(base / 2)), tarif_stopdesk: String(Math.round(base / 2) - 50) },
    };
  });
}
