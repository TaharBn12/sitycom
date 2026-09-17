<?php
/**
 * الولايات (58) + عيّنة بلديات + أسعار تجريبية
 * البلديات الحقيقية تُسحب من Ecotrack عبر GET /api/v1/get/communes
 */

function geo_wilayas() {
    static $list = null;
    if ($list === null) {
        $raw = [
            [1,'Adrar','أدرار'],[2,'Chlef','الشلف'],[3,'Laghouat','الأغواط'],[4,'Oum El Bouaghi','أم البواقي'],
            [5,'Batna','باتنة'],[6,'Béjaïa','بجاية'],[7,'Biskra','بسكرة'],[8,'Béchar','بشار'],[9,'Blida','البليدة'],
            [10,'Bouira','البويرة'],[11,'Tamanrasset','تمنراست'],[12,'Tébessa','تبسة'],[13,'Tlemcen','تلمسان'],
            [14,'Tiaret','تيارت'],[15,'Tizi Ouzou','تيزي وزو'],[16,'Alger','الجزائر'],[17,'Djelfa','الجلفة'],
            [18,'Jijel','جيجل'],[19,'Sétif','سطيف'],[20,'Saïda','سعيدة'],[21,'Skikda','سكيكدة'],
            [22,'Sidi Bel Abbès','سيدي بلعباس'],[23,'Annaba','عنابة'],[24,'Guelma','قالمة'],[25,'Constantine','قسنطينة'],
            [26,'Médéa','المدية'],[27,'Mostaganem','مستغانم'],[28,"M'Sila",'المسيلة'],[29,'Mascara','معسكر'],
            [30,'Ouargla','ورقلة'],[31,'Oran','وهران'],[32,'El Bayadh','البيض'],[33,'Illizi','إليزي'],
            [34,'Bordj Bou Arreridj','برج بوعريريج'],[35,'Boumerdès','بومرداس'],[36,'El Tarf','الطارف'],
            [37,'Tindouf','تندوف'],[38,'Tissemsilt','تيسمسيلت'],[39,'El Oued','الوادي'],[40,'Khenchela','خنشلة'],
            [41,'Souk Ahras','سوق أهراس'],[42,'Tipaza','تيبازة'],[43,'Mila','ميلة'],[44,'Aïn Defla','عين الدفلى'],
            [45,'Naâma','النعامة'],[46,'Aïn Témouchent','عين تموشنت'],[47,'Ghardaïa','غرداية'],[48,'Relizane','غليزان'],
            [49,"El M'Ghair",'المغير'],[50,'El Meniaa','المنيعة'],[51,'Ouled Djellal','أولاد جلال'],
            [52,'Bordj Badji Mokhtar','برج باجي مختار'],[53,'Béni Abbès','بني عباس'],[54,'Timimoun','تيميمون'],
            [55,'Touggourt','تقورت'],[56,'Djanet','جانت'],[57,'In Salah','عين صالح'],[58,'In Guezzam','عين قزام'],
        ];
        $list = array_map(function ($r) {
            return ['wilaya_id' => $r[0], 'name_fr' => $r[1], 'name_ar' => $r[2]];
        }, $raw);
    }
    return $list;
}

function geo_communes() {
    static $map = null;
    if ($map === null) {
        $map = [
            16 => ['Alger Centre','Bab Ezzouar','Bordj El Kiffan','Birkhadem','Kouba','Hussein Dey','El Harrach','Ain Taya','Zeralda','Birtouta','Baraki','Draria','Dely Ibrahim','Cheraga','Ben Aknoun','Hydra','Bab El Oued','Casbah','Bologhine','Rouiba','Reghaia','Dar El Beida','Sidi Moussa','Oued Smar'],
            31 => ['Oran','Es Senia','Bir El Djir','Ain El Turk','Arzew','Sidi Chahmi','Hassi Bounif','Boutlelis','El Kerma','Misserghin','Gdyel','Ain El Bia','Bethioua','Mers El Kebir','Oued Tlelat'],
            25 => ['Constantine','El Khroub','Ain Smara','Hamma Bouziane','Didouche Mourad','Beni Hamiden','Zighoud Youcef','Ain Abid','Ouled Rahmoun','Chelghoum Laid','Ali Mendjeli'],
            6  => ['Béjaïa','Akbou','Amizour','El Kseur','Sidi Aich','Kherrata','Souk El Tenine','Tichy','Aokas','Timezrit','Ouzellaguen'],
            19 => ['Sétif','El Eulma','Ain Oulmene','Bougaa','Ain Arnat','Ain Azel','Bir El Arch','Guidjel'],
            30 => ['Ouargla','Hassi Messaoud','Ain Beida','Rouissat','Sidi Khouiled','N Goussa','Oued Mya'],
            35 => ['Boumerdès','Bordj Menaiel','Boudouaou','Dellys','Thenia','Zemmouri','Issers','Khemis El Khechna','Corso','Baghlia'],
            9  => ['Blida','Boufarik','Beni Mered','Oued Alleug','El Affroun','Mouzaia','Bouarfa','Chiffa','Beni Tamou','Ouled Yaich','Bougara'],
            42 => ['Tipaza','Koléa','Hadjout','Cherchell','Fouka','Bou Ismaïl','Bouharoun','Gouraya','Sidi Amar','Nador'],
            5  => ['Batna','Barika','Ain Touta','Merouana','Tazoult','Arris','N Gaous','Ras El Aioun','Seriana','El Madher','Timgad'],
            7  => ['Biskra','Tolga','Ourlal','Sidi Okba','Zeribet El Oued','El Kantara','Doucen','El Outaya'],
            47 => ['Ghardaïa','Metlili','El Guerrara','Berriane','Daya Ben Dahoua','Zelfana','Bounoura','El Atteuf'],
            13 => ['Tlemcen','Maghnia','Ghazaouet','Nedroma','Remchi','Chetouane','Sabra','Hennaya'],
            15 => ['Tizi Ouzou','Azazga','Boghni','Larbaa Nath Irathen','Ain El Hammam','Draa El Mizan','Ouadhia','Beni Douala','Tigzirt'],
            23 => ['Annaba','El Bouni','Sidi Amar','El Hadjar','Berrahal','Ain Berda'],
            21 => ['Skikda','Collo','Azzaba','El Hadaiek','Tamalous','Ain Kechra'],
            26 => ['Médéa','Berrouaghia','Ksar El Boukhari','Beni Slimane','Souaghi','Tablat','El Omaria'],
            34 => ['Bordj Bou Arreridj','El Anasser','Bordj Ghedir','Ras El Oued','Bir Kasdali','Ain Tagrout','Mansoura'],
            39 => ['El Oued','Debila','Hassi Khalifa','Reguiba','Bayadha','Guemar','Maghrane'],
            28 => ["M'Sila",'Bou Saada','Sidi Aissa','Ain El Hadjel','Hammam Dhalaa','Ben Srour'],
            22 => ['Sidi Bel Abbès','Sidi Lahcene','Ain El Berd','Telagh','Ras El Ma','Sfisef'],
            3  => ['Laghouat','Ain Madhi','Ksar El Hirane','Aflou','Sidi Makhlouf'],
            17 => ['Djelfa','Ain Oussera','Messad','Ain Chouhada','Hassi Bahbah'],
            29 => ['Mascara','Mohammadia','Sig','Tighenif','Ain Fares','Ghriss'],
        ];
    }
    return $map;
}

function geo_mock_fees() {
    $fees = [];
    $south = [11, 33, 37, 49, 50, 51, 52, 53, 54, 56, 57, 58];
    foreach (geo_wilayas() as $w) {
        $id = (int) $w['wilaya_id'];
        $north = $id <= 48 && !in_array($id, $south, true);
        $base = $north ? 500 + (($id * 37) % 350) : 900 + (($id * 53) % 700);
        $fees[] = [
            'wilaya_id'   => $id,
            'wilaya_name' => $w['name_fr'],
            'livraison'   => ['tarif' => (string) $base, 'tarif_stopdesk' => (string) ($base - 100)],
            'pickup'      => ['tarif' => (string) ($base + 100), 'tarif_stopdesk' => (string) $base],
            'echange'     => ['tarif' => (string) ($base + 200), 'tarif_stopdesk' => (string) ($base + 100)],
            'recouvrement'=> ['tarif' => '300', 'tarif_stopdesk' => '250'],
            'retour'      => ['tarif' => (string) round($base / 2), 'tarif_stopdesk' => (string) (round($base / 2) - 50)],
        ];
    }
    return $fees;
}
